// Le cycle de la semaine : propositions du lundi, tri, téléchargements, ménage.
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Ecoute from '../../modules/ecoute';
import Telechargeur, { type DownloadJob } from '../../modules/telechargeur';
import { DEMO } from '../data/demo';
import { artistCache, db, getMeta, memo, setMeta, type Decision, type ProposalRow } from './db';
import * as dz from './deezer';
import { importListens, syncLibrary, syncPlaylists } from './ecoutes';
import { decay, genreFactor, isBlocked, listenValue, rotate, verdictScore } from './gout';
import { submitListens } from './listenbrainz';
import { artistKey, trackKey, weekKey } from './norm';
import { quotas, recommend, type Feedback, type Proposal, type Seed } from './reco';
import { exploration, similarTracks, type TrackRef } from './titres';

export const WEEKLY_COUNT = 15;
export const SEARCH_COUNT = 10;
export const KNOWN_SHARE = 0.3;
export const WIFI_ONLY = true;
const LIBRARY_DIR = 'Music/JukeBox';
const DAY = 24 * 3600 * 1000;

/** Pas de module natif (web, Expo Go) : propositions de démonstration, rien n'est téléchargé. */
export const demoMode = !Ecoute || Platform.OS === 'web';

type Taste = { artist_key: string; artist: string; genre: string | null; title: string; track_key: string; score: number; decided_at: number };

/**
 * Tes titres triés, chacun avec sa note (voir gout.ts) : garder, passer vite ou lentement,
 * YouTube, écoutes complètes ensuite, rangé ou supprimé le lundi. Les vieux tris comptent moins
 * (moitié au bout de 45 jours).
 */
export async function tastes(): Promise<Taste[]> {
  const d = await db();
  const rows = await d.getAllAsync<{
    artist_key: string; artist: string; genre: string | null; title: string; track_key: string; decision: string;
    decided_at: number; heard_s: number | null; youtube: number | null; outcome: string | null; full: number;
  }>(
    `SELECT p.artist_key, p.artist, p.genre, p.title, p.track_key, p.decision, p.decided_at, p.heard_s, p.youtube, p.outcome,
            (SELECT COUNT(*) FROM listens l WHERE l.track_key = p.track_key AND l.kind = 'listen' AND l.started_at >= p.decided_at) AS full
       FROM proposals p
      WHERE p.decision IS NOT NULL AND p.decided_at >= ? AND p.artist_key != ''`,
    Date.now() - 180 * DAY,
  );
  return rows.map((r) => ({
    artist_key: r.artist_key,
    artist: r.artist,
    genre: r.genre,
    title: r.title,
    track_key: r.track_key,
    decided_at: r.decided_at,
    score:
      verdictScore({ decision: r.decision, heardS: r.heard_s, youtube: !!r.youtube, outcome: r.outcome, fullListens: r.full }) *
      decay(r.decided_at, 45),
  }));
}

/** Tes écoutes Samsung Music par artiste, les récentes d'abord (moitié du poids au bout de 4 semaines). */
async function listenScores(days: number, halfLife: number) {
  const rows = await (await db()).getAllAsync<{ artist_key: string; artist: string; track_key: string; title: string; kind: string; started_at: number }>(
    "SELECT artist_key, artist, track_key, title, kind, started_at FROM listens WHERE started_at >= ? AND artist_key != ''",
    Date.now() - days * DAY,
  );
  const artists = new Map<string, { name: string; score: number; n: number }>();
  const tracks = new Map<string, { artist: string; title: string; score: number }>();
  for (const r of rows) {
    const w = decay(r.started_at, halfLife);
    const a = artists.get(r.artist_key) ?? { name: r.artist, score: 0, n: 0 };
    a.score += listenValue(r.kind) * w;
    if (r.kind === 'listen') a.n += 1;
    artists.set(r.artist_key, a);
    if (r.kind === 'listen') {
      const t = tracks.get(r.track_key) ?? { artist: r.artist, title: r.title, score: 0 };
      t.score += w;
      tracks.set(r.track_key, t);
    }
  }
  return { artists, tracks };
}

/**
 * Artistes « graines ». Tes écoutes prennent le dessus progressivement : à 0 écoute, c'est la
 * musique du téléphone ; à partir de 40 écoutes complètes, ce sont surtout tes écoutes.
 * Les découvertes que tu as aimées (gardées, réécoutées, rangées) pèsent aussi.
 */
export async function seeds(): Promise<{ seeds: Seed[]; listenShare: number }> {
  const d = await db();
  const { artists: listened } = await listenScores(120, 28);
  const owned = await d.getAllAsync<{ artist_key: string; artist: string; n: number }>(
    `SELECT artist_key, MAX(artist) AS artist, COUNT(*) AS n FROM library
      WHERE artist_key != '' GROUP BY artist_key`,
  );
  const inPlaylists = await d.getAllAsync<{ playlist: string; artist_key: string; artist: string }>(
    "SELECT playlist, artist_key, artist FROM playlist_tracks WHERE artist_key != ''",
  );
  const liked = new Map<string, { name: string; score: number }>();
  for (const t of await tastes()) {
    if (t.score <= 0) continue;
    const e = liked.get(t.artist_key) ?? { name: t.artist, score: 0 };
    e.score += t.score;
    liked.set(t.artist_key, e);
  }
  const totalListens = [...listened.values()].reduce((a, r) => a + r.n, 0);
  const listenShare = Math.min(1, totalListens / 40);
  const ownedTotal = owned.reduce((a, r) => a + r.n, 0) || 1;
  const listenTotal = [...listened.values()].reduce((a, r) => a + Math.max(0, r.score), 0) || 1;
  const likedTotal = [...liked.values()].reduce((a, e) => a + e.score, 0) || 1;
  const map = new Map<string, Seed>();
  const add = (key: string, name: string, w: number) => {
    const s = map.get(key) ?? { key, name, weight: 0 };
    s.weight += w;
    map.set(key, s);
  };
  // Tes playlists (hors fourre-tout) pèsent plus que la simple présence sur le téléphone ;
  // une playlist « Favoris » compte triple.
  const plScore = new Map<string, { name: string; n: number }>();
  for (const r of inPlaylists) {
    if (IGNORED_PLAYLIST.test(r.playlist)) continue;
    const e = plScore.get(r.artist_key) ?? { name: r.artist, n: 0 };
    e.n += FAVORITES.test(r.playlist) ? 3 : 1;
    plScore.set(r.artist_key, e);
  }
  const plTotal = [...plScore.values()].reduce((a, e) => a + e.n, 0);
  const ownedFactor = plTotal ? 0.3 : 1;
  // Chaque source est normalisée : 4 écoutes pèsent vite plus que 300 titres sur le téléphone.
  for (const r of owned) add(r.artist_key, r.artist, ownedFactor * (1 - listenShare * 0.85) * (r.n / ownedTotal));
  for (const [key, e] of plScore) add(key, e.name, (1 - listenShare * 0.6) * (e.n / plTotal));
  for (const [key, r] of listened) add(key, r.name, (0.3 + listenShare) * (r.score / listenTotal) * 2);
  // Tes coups de cœur du tri : autant qu'une bonne partie de tes écoutes dès qu'il y en a quelques-uns.
  const likedWeight = Math.min(0.8, liked.size * 0.1);
  for (const [key, e] of liked) add(key, e.name, likedWeight * (e.score / likedTotal));
  return { seeds: [...map.values()].filter((s) => s.weight > 0), listenShare };
}

// Playlists automatiques (créées par le lecteur ou une appli de téléchargement) : pas un style.
const IGNORED_PLAYLIST = /^(auto\b|snaptube)/i;
const FAVORITES = /favori|favourite|favorite/i;

export type StyleGroup = { name: string; share: number; size: number; seeds: Seed[] };

/**
 * Tes playlists de style (Rap FR, Chill…) : chacune reçoit une part de la sélection selon sa
 * taille et ce que tu en écoutes, et ses artistes servent de point de départ. Les points de
 * départ tournent d'une semaine à l'autre (les plus forts sortent plus souvent).
 */
export async function styleGroups(): Promise<StyleGroup[]> {
  const d = await db();
  const rows = await d.getAllAsync<{ playlist: string; artist_key: string; artist: string; track_key: string }>(
    "SELECT playlist, artist_key, artist, track_key FROM playlist_tracks WHERE artist_key != ''",
  );
  const { artists: listened, tracks } = await listenScores(120, 28);
  const taste = await tastes();
  const likedArtist = new Map<string, { name: string; score: number }>();
  for (const t of taste) {
    if (t.score <= 0) continue;
    const e = likedArtist.get(t.artist_key) ?? { name: t.artist, score: 0 };
    e.score += t.score;
    likedArtist.set(t.artist_key, e);
  }
  const byList = new Map<string, typeof rows>();
  for (const r of rows) {
    if (IGNORED_PLAYLIST.test(r.playlist) || FAVORITES.test(r.playlist)) continue;
    byList.set(r.playlist, [...(byList.get(r.playlist) ?? []), r]);
  }
  const groups: StyleGroup[] = [];
  for (const [name, list] of byList) {
    if (list.length < 5) continue;
    const artists = new Map<string, Seed>();
    let played = 0;
    for (const r of list) {
      played += tracks.get(r.track_key)?.score ?? 0;
      const s = artists.get(r.artist_key) ?? { key: r.artist_key, name: r.artist, weight: 0 };
      s.weight += 1;
      artists.set(r.artist_key, s);
    }
    for (const s of artists.values()) {
      s.weight += 2 * Math.max(0, listened.get(s.key)?.score ?? 0);
      s.weight += 2 * (likedArtist.get(s.key)?.score ?? 0);
    }
    const sorted = [...artists.values()].sort((a, b) => b.weight - a.weight);
    const seeds = rotate(sorted, (s) => s.weight, 2, 4, 10);
    // Racine de la taille : une grosse playlist pèse plus qu'une petite, sans tout écraser.
    groups.push({ name, size: list.length, share: Math.sqrt(list.length) * (1 + played / 10), seeds });
  }

  // « Tes écoutes » : les artistes que tu écoutes en ce moment (30 jours). Plus tu écoutes,
  // plus ce groupe prend de place : jusqu'à la moitié des nouveautés vers 50 écoutes complètes.
  const { artists: recent } = await listenScores(30, 14);
  const fullListens = [...recent.values()].reduce((a, r) => a + r.n, 0);
  const top = [...recent.entries()]
    .filter(([, r]) => r.score > 0)
    .sort((a, b) => b[1].score - a[1].score)
    .map(([key, r]) => ({ key, name: r.name, weight: r.score }));
  if (top.length >= 2 && fullListens >= 5) {
    const others = groups.reduce((a, g) => a + g.share, 0) || 1;
    const part = Math.min(0.5, fullListens / 100);
    groups.push({
      name: 'Tes écoutes',
      size: fullListens,
      share: (others * part) / (1 - part),
      seeds: rotate(top, (s) => s.weight, 3, 6, 10),
    });
  }

  // « Tes coups de cœur » : les découvertes que tu as gardées, réécoutées ou rangées.
  const liked = [...likedArtist.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([key, e]) => ({ key, name: e.name, weight: e.score }));
  if (liked.length >= 2) {
    const others = groups.reduce((a, g) => a + g.share, 0) || 1;
    const part = Math.min(0.3, liked.length / 30);
    groups.push({ name: 'Tes coups de cœur', size: liked.length, share: (others * part) / (1 - part), seeds: rotate(liked, (s) => s.weight, 2, 5, 12) });
  }
  return groups.sort((a, b) => b.share - a.share);
}

/** Ce que tu as gardé ou passé au tri, par artiste et par genre (notes de gout.ts). */
export async function feedback(): Promise<Feedback> {
  const fb: Feedback = { artistKeep: new Map(), artistReject: new Map(), genreFactor: new Map() };
  const genres = new Map<string, { keep: number; reject: number }>();
  for (const t of await tastes()) {
    const liked = t.score > 0;
    const map = liked ? fb.artistKeep : fb.artistReject;
    map.set(t.artist_key, (map.get(t.artist_key) ?? 0) + Math.abs(t.score));
    if (t.genre) {
      const g = genres.get(t.genre) ?? { keep: 0, reject: 0 };
      if (liked) g.keep += t.score; else g.reject -= t.score;
      genres.set(t.genre, g);
    }
  }
  for (const [g, c] of genres) fb.genreFactor.set(g, genreFactor(c.keep, c.reject));
  return fb;
}

/** Artistes passés nettement plus souvent que gardés : plus proposés comme nouveaux. */
function blocked(fb: Feedback): Set<string> {
  const out = new Set<string>();
  for (const [key, reject] of fb.artistReject) if (isBlocked(fb.artistKeep.get(key) ?? 0, reject)) out.add(key);
  return out;
}

async function exclusions() {
  const d = await db();
  const lib = await d.getAllAsync<{ track_key: string; artist_key: string }>('SELECT track_key, artist_key FROM library');
  const prop = await d.getAllAsync<{ id: string; track_key: string; artist_key: string; created_at: number; decision: string | null }>(
    'SELECT id, track_key, artist_key, created_at, decision FROM proposals',
  );
  const ownedTitles = new Map<string, string[]>();
  for (const r of lib) {
    const [artist, title] = r.track_key.split('|');
    if (!artist || !title) continue;
    ownedTitles.set(artist, [...(ownedTitles.get(artist) ?? []), title]);
  }
  // Artistes déjà proposés ces 4 dernières semaines sans être gardés : place aux autres.
  const recentArtists = new Map<string, number>();
  for (const r of prop) {
    if (r.created_at < Date.now() - 28 * DAY || r.decision === 'keep' || r.decision === 'have') continue;
    recentArtists.set(r.artist_key, (recentArtists.get(r.artist_key) ?? 0) + 1);
  }
  return {
    ownedTitles,
    ownedTracks: new Set(lib.map((r) => r.track_key)),
    ownedArtists: new Set(lib.map((r) => r.artist_key).filter(Boolean)),
    excludedTracks: new Set(prop.map((r) => r.track_key)),
    excludedIds: new Set(prop.map((r) => r.id)),
    recentArtists,
  };
}

async function save(batch: string, source: 'weekly' | 'search', list: Proposal[]) {
  const d = await db();
  const now = Date.now();
  await d.withTransactionAsync(async () => {
    for (const [i, p] of list.entries()) {
      await d.runAsync(
        `INSERT OR IGNORE INTO proposals (id, batch, source, position, created_at, title, artist, artist_key, track_key,
           album, duration_s, cover, cover_medium, genre, reason, kind, deezer_artist_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        p.id, batch, source, i, now, p.title, p.artist, p.artistKey, p.trackKey, p.album, p.durationS,
        p.cover, p.coverMedium, p.genre, p.reason, p.kind, p.deezerArtistId,
      );
    }
  });
}

function exclude(ex: Awaited<ReturnType<typeof exclusions>>, list: Proposal[]) {
  for (const p of list) {
    ex.excludedIds.add(p.id);
    ex.excludedTracks.add(p.trackKey);
  }
}

/** Les titres « tu connais » répartis à peu près tous les trois titres. */
function interleave(fresh: Proposal[], known: Proposal[]): Proposal[] {
  const out: Proposal[] = [];
  const step = known.length ? Math.max(2, Math.floor((fresh.length + known.length) / known.length)) : 0;
  let k = 0;
  for (const p of fresh) {
    out.push(p);
    if (step && out.length % step === step - 1 && k < known.length) out.push(known[k++]);
  }
  while (k < known.length) out.push(known[k++]);
  return out;
}

/** Tes titres préférés du moment : écoutés en entier récemment, ou découvertes que tu as aimées. */
async function favoriteTracks(): Promise<TrackRef[]> {
  const { tracks } = await listenScores(90, 28);
  const all = new Map<string, TrackRef>();
  for (const t of tracks.values()) {
    if (!t.artist || !t.title) continue;
    all.set(trackKey(t.artist, t.title), { artist: t.artist, title: t.title, weight: t.score });
  }
  for (const t of await tastes()) {
    if (t.score <= 0) continue;
    const e = all.get(t.track_key) ?? { artist: t.artist, title: t.title, weight: 0 };
    e.weight += t.score;
    all.set(t.track_key, e);
  }
  const sorted = [...all.values()].sort((a, b) => b.weight - a.weight);
  return rotate(sorted, (t) => t.weight, 2, 6, 14);
}

/** Les genres de tes artistes (d'après le cache, sans réseau) : pour écarter le hors-sujet. */
async function yourGenres(seedList: Seed[]): Promise<Set<string> | null> {
  const out = new Set<string>();
  for (const s of [...seedList].sort((a, b) => b.weight - a.weight).slice(0, 30)) {
    const g = (await artistCache.get(s.key))?.genre;
    if (g) out.add(g);
  }
  return out.size >= 2 ? out : null;
}

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function generate(batch: string, onProgress?: (m: string) => void) {
  let list: Proposal[];
  if (demoMode) {
    list = DEMO;
  } else {
    const { seeds: s } = await seeds();
    if (!s.length) throw new Error("Aucun artiste trouvé sur le téléphone. Vérifie l'accès à ta musique dans les réglages.");
    const ex = await exclusions();
    const fb = await feedback();
    const base = { ...ex, feedback: fb, blockedArtists: blocked(fb), cache: artistCache, memo, onProgress };
    const groups = await styleGroups();

    // 30 % : des titres que tu n'as pas d'artistes que tu as déjà.
    const known = await recommend({ ...base, seeds: s, count: Math.round(WEEKLY_COUNT * KNOWN_SHARE), knownShare: 1 });
    exclude(ex, known);
    const newCount = WEEKLY_COUNT - known.length;

    // Titre par titre : ta Weekly Exploration (compte ListenBrainz relié), puis ce qui s'écoute
    // après tes titres préférés. Jusqu'à 45 % des nouveautés à eux deux.
    const fresh: Proposal[] = [];
    const lbUser = await getMeta('lb_user');
    if (lbUser) {
      onProgress?.('Ta Weekly Exploration');
      const picks = await exploration({ ...base, onProgress: undefined }, lbUser, Math.round(newCount * 0.25)).catch(() => []);
      exclude(ex, picks);
      fresh.push(...picks);
    }
    const refs = await favoriteTracks();
    if (refs.length >= 3) {
      onProgress?.('Titres dans la lignée des tiens');
      const want = Math.round(newCount * 0.45) - fresh.length;
      const picks = await similarTracks({ ...base, onProgress: undefined }, refs, want, await yourGenres(s)).catch(() => []);
      exclude(ex, picks);
      fresh.push(...picks);
    }

    // Le reste : des artistes nouveaux, répartis entre tes playlists (ou tes graines s'il n'y en a pas).
    const rest = newCount - fresh.length;
    if (groups.length >= 2 && rest > 0) {
      const quota = quotas(new Map(groups.map((g) => [g.name, g.share])), rest);
      // Toutes les playlists en même temps (les réponses déjà en cache reviennent tout de suite).
      onProgress?.('Choix des titres');
      const active = groups.filter((g) => (quota.get(g.name) ?? 0) > 0);
      const results = await Promise.all(
        active.map((g) =>
          recommend({ ...base, onProgress: undefined, seeds: g.seeds, count: quota.get(g.name) ?? 0, knownShare: 0 })
            .then((picks) => picks.map((p) => ({ ...p, reason: `${g.name} · ${p.reason.charAt(0).toLowerCase()}${p.reason.slice(1)}` })))
            .catch(() => [] as Proposal[]),
        ),
      );
      // Deux playlists peuvent tomber sur le même titre : on garde le premier.
      const seen = new Set<string>();
      for (const p of results.flat()) {
        if (seen.has(p.trackKey) || seen.has(p.id) || ex.excludedIds.has(p.id)) continue;
        seen.add(p.trackKey);
        seen.add(p.id);
        fresh.push(p);
      }
      exclude(ex, fresh);
    }
    if (fresh.length < newCount) {
      const more = await recommend({ ...base, seeds: s, count: newCount - fresh.length, knownShare: 0 });
      exclude(ex, more);
      fresh.push(...more);
    }
    list = interleave(shuffle(fresh), known);
  }
  if (!list.length) throw new Error('Pas de titre trouvé pour le moment. Vérifie ta connexion.');
  await save(batch, 'weekly', list);
  await setMeta('batch_current', batch);
}

/** La sélection en cours : celle du lundi, ou la dernière régénérée cette semaine. */
export async function ensureWeek(onProgress?: (m: string) => void): Promise<string> {
  const week = weekKey();
  if ((await getMeta('batch_week')) === week) {
    const current = await getMeta('batch_current');
    return current && current.startsWith(week) ? current : week;
  }

  if (demoMode) await demoListens();
  onProgress?.('Rangement de la semaine passée');
  await refresh(true);
  await cleanup();
  await generate(week, onProgress);
  await setMeta('batch_week', week);
  return week;
}

/** Aperçu web : un mois d'écoutes inventées à partir des titres de démo, pour l'écran Stats. */
async function demoListens() {
  const d = await db();
  if ((await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM listens'))?.n) return;
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const now = Date.now();
  await d.withTransactionAsync(async () => {
    for (let i = 0; i < 160; i++) {
      // Les premiers titres reviennent plus souvent, surtout le soir et le week-end.
      const p = DEMO[Math.floor(Math.pow(rand(), 1.8) * DEMO.length)];
      const day = Math.floor(rand() * 28);
      const hour = [8, 12, 18, 19, 20, 21, 22, 23][Math.floor(rand() * 8)];
      const at = new Date(now - day * DAY);
      at.setHours(hour, Math.floor(rand() * 60));
      const durationMs = p.durationS * 1000;
      const kind = rand() < 0.8 ? 'listen' : 'skip';
      const played = kind === 'listen' ? durationMs : 12_000;
      await d.runAsync(
        `INSERT INTO listens (started_at, ended_at, title, artist, album, duration_ms, played_ms, pkg, kind, artist_key, track_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'demo', ?, ?, ?)`,
        at.getTime(), at.getTime() + played, p.title, p.artist, p.album, durationMs, played, kind, p.artistKey, p.trackKey,
      );
    }
  });
}

/** Nouvelle sélection à la demande, en tenant compte du tri déjà fait. */
export async function regenerate(onProgress?: (m: string) => void): Promise<string> {
  // Écoutes et téléchargements relus ; la bibliothèque et les playlists seulement si > 10 min.
  await refresh();
  const batch = `${weekKey()}+${Date.now()}`;
  await generate(batch, onProgress);
  return batch;
}

/** Découverte à la demande à partir d'un artiste ou d'un titre tapé. */
export async function discover(query: string, onProgress?: (m: string) => void): Promise<string> {
  const batch = `search-${Date.now()}`;
  let list: Proposal[];
  if (demoMode) {
    // Identifiants propres à la recherche, sinon la base les prend pour ceux du lundi.
    list = [...DEMO.slice(3), ...DEMO.slice(0, 3)].slice(0, SEARCH_COUNT).map((p) => ({ ...p, id: `${p.id}-${batch}`, trackKey: `${p.trackKey}-${batch}` }));
  } else {
    onProgress?.(`Recherche de ${query}`);
    const found = await dz.searchAny(query);
    const artist = found.artists.find((a) => artistKey(a.name) === artistKey(query)) ?? found.tracks[0]?.artist ?? found.artists[0];
    if (!artist) throw new Error(`Aucun artiste ne correspond à « ${query} ».`);
    const ex = await exclusions();
    const fb = await feedback();
    const block = blocked(fb);
    block.delete(artistKey(artist.name));
    list = await recommend({
      seeds: [{ key: artistKey(artist.name), name: artist.name, weight: 1 }],
      ...ex,
      ownedArtists: new Set([...ex.ownedArtists].filter((k) => k !== artistKey(artist.name))),
      blockedArtists: block,
      feedback: fb,
      cache: artistCache,
      memo,
      count: SEARCH_COUNT,
      knownShare: 0,
      seedTracks: 2,
      onProgress,
    });
  }
  if (!list.length) throw new Error('Pas assez de titres proches pour cet artiste.');
  await save(batch, 'search', list);
  return batch;
}

export async function pending(batch: string): Promise<ProposalRow[]> {
  return (await db()).getAllAsync<ProposalRow>(
    'SELECT * FROM proposals WHERE batch = ? AND decision IS NULL ORDER BY position',
    batch,
  );
}

export async function batchRows(batch: string): Promise<ProposalRow[]> {
  return (await db()).getAllAsync<ProposalRow>('SELECT * FROM proposals WHERE batch = ? ORDER BY position', batch);
}

/** Lien d'extrait frais : ceux de Deezer expirent au bout de quelques heures. */
export async function previewUrl(id: string): Promise<string | null> {
  if (demoMode) return DEMO.find((p) => id === p.id || id.startsWith(`${p.id}-`))?.preview ?? null;
  return (await dz.track(id))?.preview ?? null;
}

export async function decide(row: ProposalRow, decision: Decision, signal?: { heardS: number; youtube: boolean }) {
  const d = await db();
  await d.runAsync(
    'UPDATE proposals SET decision = ?, decided_at = ?, heard_s = ?, youtube = ? WHERE id = ?',
    decision, Date.now(), signal?.heardS ?? null, signal ? Number(signal.youtube) : null, row.id,
  );
  if (decision === 'keep') await enqueue(row);
}

async function enqueue(row: ProposalRow) {
  const d = await db();
  if (!Telechargeur) return;
  // Année, numéro de piste et grande pochette pour les tags du fichier.
  let full: dz.DzTrack | null = null;
  try { full = await dz.track(row.id); } catch { /* tags plus pauvres, tant pis */ }
  const job: DownloadJob = {
    id: row.id,
    title: row.title,
    artist: row.artist,
    album: full?.album?.title ?? row.album,
    year: (full?.release_date ?? '').slice(0, 4),
    trackNumber: full?.track_position ?? 0,
    durationS: full?.duration ?? row.duration_s,
    coverUrl: full?.album?.cover_xl ?? row.cover,
  };
  Telechargeur.enqueue(JSON.stringify(job), WIFI_ONLY);
  await d.runAsync("UPDATE proposals SET dl_status = 'queued', dl_error = NULL WHERE id = ?", row.id);
}

/** Les titres mis en file par l'ancienne version (contrainte de stockage) sont relancés une fois. */
async function requeueOnce() {
  if ((await getMeta('requeue_v2')) === 'ok' || !Telechargeur) return;
  const rows = await (await db()).getAllAsync<ProposalRow>("SELECT * FROM proposals WHERE dl_status = 'queued'");
  for (const r of rows) await enqueue(r).catch(() => undefined);
  await setMeta('requeue_v2', 'ok');
}

export async function retry(row: ProposalRow) {
  await enqueue(row);
}

/** Relit les écoutes et les téléchargements ; la bibliothèque et les playlists toutes les 10 min. */
export async function refresh(force = false) {
  if (demoMode) return;
  await importListens();
  await sendToListenBrainz().catch(() => undefined);
  await syncDownloads();
  await requeueOnce();
  const last = Number((await getMeta('lib_sync')) ?? 0);
  if (force || Date.now() - last > 10 * 60 * 1000) {
    await syncLibrary();
    await syncPlaylists().catch(() => 0);
    await setMeta('lib_sync', String(Date.now()));
  }
}

/** Compte ListenBrainz relié : on lui envoie les écoutes complètes pas encore envoyées. */
async function sendToListenBrainz() {
  const token = await getMeta('lb_token');
  if (!token) return;
  const d = await db();
  let last = Number((await getMeta('lb_sent_id')) ?? 0);
  for (;;) {
    const rows = await d.getAllAsync<{ id: number; started_at: number; artist: string; title: string; album: string; duration_ms: number; pkg: string }>(
      "SELECT id, started_at, artist, title, album, duration_ms, pkg FROM listens WHERE id > ? AND kind = 'listen' AND artist != '' ORDER BY id LIMIT 500",
      last,
    );
    if (!rows.length) return;
    await submitListens(
      token,
      rows.map((r) => ({
        listenedAt: r.started_at,
        artist: r.artist,
        title: r.title,
        album: r.album ?? '',
        durationMs: r.duration_ms ?? 0,
        player: r.pkg === 'com.sec.android.app.music' ? 'Samsung Music' : r.pkg,
      })),
    );
    last = rows[rows.length - 1].id;
    await setMeta('lb_sent_id', String(last));
  }
}

async function syncDownloads() {
  if (!Telechargeur) return;
  const text = Telechargeur.drainResults();
  if (!text) return;
  const d = await db();
  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const r = JSON.parse(line) as { id: string; ok: boolean; final?: boolean; uri?: string; error?: string; at: number };
      if (!r.ok && r.final === false) {
        // Essai raté, un autre est prévu : on garde l'erreur pour l'afficher.
        await d.runAsync('UPDATE proposals SET dl_error = ? WHERE id = ?', r.error ?? 'Erreur', r.id);
        continue;
      }
      if (r.ok) {
        await d.runAsync("UPDATE proposals SET dl_status = 'done', uri = ?, dl_at = ?, dl_error = NULL WHERE id = ?", r.uri ?? null, r.at, r.id);
      } else {
        await d.runAsync("UPDATE proposals SET dl_status = 'failed', dl_error = ? WHERE id = ?", r.error ?? 'Erreur', r.id);
      }
    } catch { /* ligne illisible */ }
  }
}

/**
 * Ménage du lundi, pour les découvertes téléchargées depuis au moins 6 jours :
 * - écoutée en entier 2 fois → rejoint ta bibliothèque (Music/JukeBox) ;
 * - écoutée en entier 1 fois → on lui laisse une semaine de plus, puis elle est gardée ;
 * - jamais écoutée en entier (passée ou ignorée) → supprimée.
 */
export async function cleanup(): Promise<{ kept: number; deleted: number }> {
  const res = { kept: 0, deleted: 0 };
  if (!Telechargeur) return res;
  const d = await db();
  const rows = await d.getAllAsync<ProposalRow>(
    "SELECT * FROM proposals WHERE dl_status = 'done' AND outcome IS NULL AND uri IS NOT NULL AND dl_at < ?",
    Date.now() - 6 * DAY,
  );
  for (const row of rows) {
    const c = await d.getFirstAsync<{ full: number }>(
      "SELECT COUNT(*) AS full FROM listens WHERE track_key = ? AND kind = 'listen' AND started_at >= ?",
      row.track_key, row.dl_at ?? 0,
    );
    const full = c?.full ?? 0;
    const weeks = (Date.now() - (row.dl_at ?? 0)) / (7 * DAY);
    if (full >= 2 || (full === 1 && weeks >= 1.85)) {
      await Telechargeur.moveMedia(row.uri!, LIBRARY_DIR);
      await d.runAsync("UPDATE proposals SET outcome = 'library', outcome_at = ? WHERE id = ?", Date.now(), row.id);
      res.kept += 1;
    } else if (full === 0) {
      await Telechargeur.deleteMedia(row.uri!);
      await d.runAsync("UPDATE proposals SET outcome = 'deleted', outcome_at = ? WHERE id = ?", Date.now(), row.id);
      res.deleted += 1;
    }
  }
  return res;
}

export async function scheduleMonday() {
  if (Platform.OS === 'web') return;
  if ((await getMeta('notif_v1')) === 'ok') return;
  const perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return;
  await Notifications.setNotificationChannelAsync('lundi', {
    name: 'Sélection du lundi',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.scheduleNotificationAsync({
    content: { title: 'JukeBox', body: `Ta sélection de la semaine est prête : ${WEEKLY_COUNT} titres à écouter.` },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 2,
      hour: 8,
      minute: 0,
      channelId: 'lundi',
    },
  });
  await setMeta('notif_v1', 'ok');
}
