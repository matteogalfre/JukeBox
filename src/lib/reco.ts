// Moteur de recommandation.
//
// 1. Les artistes « graines » : ceux que tu écoutes le plus (ou, au début, ceux qui ont le
//    plus de titres sur ton téléphone).
// 2. Leurs artistes similaires : ListenBrainz (écoutes de tous ses utilisateurs) + Deezer.
// 3. Répartition par genre, à l'image de tes graines.
// 4. Pour chaque artiste retenu, son titre le plus populaire que tu n'as pas encore,
//    hors versions live.
import * as dz from './deezer';
import * as lb from './listenbrainz';
import { rotate } from './gout';
import { artistKey, isLive, trackKey } from './norm';

export type Seed = { key: string; name: string; weight: number };

export type ArtistInfo = {
  key: string;
  name: string;
  deezerId: number | null;
  mbid: string | null;
  genre: string | null;
  checkedAt: number;
};

/** Petit cache clé → texte avec durée de vie (stocké en base sur le téléphone). */
export type Memo = {
  get(key: string, maxAgeMs: number): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
};

export type ArtistCache = {
  get(key: string): Promise<ArtistInfo | undefined>;
  set(info: ArtistInfo): Promise<void>;
};

export type Proposal = {
  id: string;
  title: string;
  artist: string;
  artistKey: string;
  trackKey: string;
  album: string;
  durationS: number;
  cover: string;
  coverMedium: string;
  preview: string;
  genre: string | null;
  reason: string;
  kind: 'new' | 'known';
  deezerArtistId: number;
};

/** Ton tri passé : artistes gardés / passés, et un facteur par genre (1 = neutre). */
export type Feedback = {
  artistKeep: Map<string, number>;
  artistReject: Map<string, number>;
  genreFactor: Map<string, number>;
};

export type RecoInput = {
  seeds: Seed[];
  ownedArtists: Set<string>;
  ownedTracks: Set<string>;
  /** Titres présents sur le téléphone, par artiste (comparaison souple). */
  ownedTitles?: Map<string, string[]>;
  excludedTracks: Set<string>;
  excludedIds: Set<string>;
  /** Artistes à ne pas proposer comme « nouveaux » (nettement plus passés que gardés). */
  blockedArtists?: Set<string>;
  /** Artistes déjà proposés ces dernières semaines sans être gardés (nombre de fois). */
  recentArtists?: Map<string, number>;
  /** Tirage des graines ; Math.random par défaut, fixé dans les essais. */
  rand?: () => number;
  feedback?: Feedback;
  cache: ArtistCache;
  memo?: Memo;
  count: number;
  knownShare: number;
  /** Titres de la graine elle-même (découverte à la demande). */
  seedTracks?: number;
  onProgress?: (message: string) => void;
};

const DAY = 24 * 3600 * 1000;
const MONTH = 30 * DAY;

/** Réponse réseau gardée en cache : les artistes proches ne changent pas d'une heure à l'autre. */
export async function cached<T>(input: Pick<RecoInput, 'memo'>, key: string, maxAgeMs: number, fetcher: () => Promise<T>): Promise<T> {
  const m = input.memo;
  if (!m) return fetcher();
  const hit = await m.get(key, maxAgeMs);
  if (hit !== null) return JSON.parse(hit) as T;
  const value = await fetcher();
  await m.set(key, JSON.stringify(value));
  return value;
}

export async function resolve(input: Pick<RecoInput, 'cache'>, name: string, known?: Partial<ArtistInfo>): Promise<ArtistInfo> {
  const key = artistKey(name);
  const cached = await input.cache.get(key);
  if (cached && Date.now() - cached.checkedAt < 6 * MONTH) {
    if (known?.deezerId && !cached.deezerId) cached.deezerId = known.deezerId;
    return cached;
  }
  const info: ArtistInfo = {
    key,
    name,
    deezerId: known?.deezerId ?? null,
    mbid: known?.mbid ?? null,
    genre: known?.genre ?? null,
    checkedAt: Date.now(),
  };
  try {
    if (!info.deezerId) info.deezerId = (await dz.searchArtist(name))?.id ?? null;
    if (info.deezerId && !info.genre) info.genre = await dz.artistGenre(info.deezerId);
  } catch {
    // Deezer indisponible : on retentera au prochain passage.
    return info;
  }
  await input.cache.set(info);
  return info;
}

async function withMbid(input: RecoInput, info: ArtistInfo): Promise<ArtistInfo> {
  if (info.mbid) return info;
  try {
    // Un artiste introuvable sur MusicBrainz n'est recherché qu'une fois par mois.
    info.mbid = await cached(input, `mbid:${info.key}`, MONTH, () => lb.findMbid(info.name));
    if (info.mbid) await input.cache.set({ ...info, checkedAt: Date.now() });
  } catch {
    // MusicBrainz est souvent saturé : on se contentera de Deezer.
  }
  return info;
}

/** Répartit n places entre des genres selon leurs parts (plus forts restes). */
export function quotas(shares: Map<string, number>, n: number): Map<string, number> {
  const total = [...shares.values()].reduce((a, b) => a + b, 0) || 1;
  const raw = [...shares.entries()].map(([g, w]) => ({ g, exact: (w / total) * n }));
  const out = new Map(raw.map((r) => [r.g, Math.floor(r.exact)]));
  let left = n - [...out.values()].reduce((a, b) => a + b, 0);
  raw.sort((a, b) => (b.exact % 1) - (a.exact % 1));
  for (const r of raw) {
    if (left <= 0) break;
    out.set(r.g, (out.get(r.g) ?? 0) + 1);
    left -= 1;
  }
  return out;
}

/** « Bye Bye (feat. X) » et « Bye Bye - Remastered » : même titre que « Bye Bye ». */
function ownedLoosely(input: Exclusions, key: string): boolean {
  const [artist, title] = key.split('|');
  const list = input.ownedTitles?.get(artist);
  if (!list || title.length < 3) return false;
  return list.some((o) => o === title || (o.length >= 4 && (o.startsWith(title + ' ') || title.startsWith(o + ' '))));
}

export type Exclusions = Pick<RecoInput, 'excludedIds' | 'excludedTracks' | 'ownedTracks' | 'ownedTitles'>;

/** Titre proposable : écoutable, ni trop court ni trop long, pas live, pas déjà chez toi ni déjà proposé. */
export function allowed(input: Exclusions, t: dz.DzTrack, taken: Set<string>): { id: string; key: string } | null {
  if (t.readable === false || !t.preview) return null;
  if (t.duration < 90 || t.duration > 480) return null;
  if (isLive(t.title, t.title_version, t.album?.title)) return null;
  const id = String(t.id);
  const key = trackKey(t.artist.name, t.title);
  if (input.excludedIds.has(id) || input.excludedTracks.has(key) || input.ownedTracks.has(key) || taken.has(key)) return null;
  if (ownedLoosely(input, key)) return null;
  return { id, key };
}

function pickTrack(input: RecoInput, tracks: dz.DzTrack[], artistId: number, taken: Set<string>) {
  for (const t of tracks) {
    if (t.artist?.id !== artistId) continue;
    const ok = allowed(input, t, taken);
    if (ok) return { t, ...ok };
  }
  return null;
}

export function toProposal(
  t: dz.DzTrack,
  id: string,
  key: string,
  genre: string | null,
  reason: string,
  kind: Proposal['kind'],
): Proposal {
  return {
    id,
    title: t.title,
    artist: t.artist.name,
    artistKey: artistKey(t.artist.name),
    trackKey: key,
    album: t.album?.title ?? '',
    durationS: t.duration,
    cover: t.album?.cover_xl ?? t.album?.cover_medium ?? '',
    coverMedium: t.album?.cover_medium ?? '',
    preview: t.preview,
    genre,
    reason,
    kind,
    deezerArtistId: t.artist.id,
  };
}

export async function recommend(input: RecoInput): Promise<Proposal[]> {
  const say = input.onProgress ?? (() => undefined);
  // Les 4 plus fortes graines restent, les 6 autres sont tirées au sort parmi les 16 suivantes
  // (pondéré) : la sélection change d'une semaine à l'autre sans perdre ce que tu écoutes le plus.
  const sorted = [...input.seeds].sort((a, b) => b.weight - a.weight);
  const seeds = rotate(sorted, (s) => s.weight, 4, 10, 16, input.rand);
  if (!seeds.length) return [];
  // Pour que la sélection reflète toute ta musique et pas un seul artiste : poids aplatis
  // (racine carrée) puis plafonnés à 20 % chacun.
  const flat = seeds.map((s) => Math.sqrt(s.weight));
  const flatTotal = flat.reduce((a, w) => a + w, 0) || 1;
  const capped = flat.map((w) => Math.min(w, 0.2 * flatTotal));
  const totalW = capped.reduce((a, w) => a + w, 0) || 1;

  say('Lecture de tes écoutes');
  const seedInfos: (ArtistInfo & { w: number })[] = [];
  for (const [i, s] of seeds.entries()) {
    const info = await resolve(input, s.name);
    seedInfos.push({ ...info, w: capped[i] / totalW });
  }

  // Profil de genres (pondéré par tes écoutes).
  const genreShare = new Map<string, number>();
  for (const s of seedInfos) if (s.genre) genreShare.set(s.genre, (genreShare.get(s.genre) ?? 0) + s.w);
  // Un genre que tu passes souvent au tri perd de la place, un genre que tu gardes en gagne.
  const fb = input.feedback;
  if (fb) for (const [g, w] of genreShare) genreShare.set(g, w * (fb.genreFactor.get(g) ?? 1));
  const rejects = (key: string) => fb?.artistReject.get(key) ?? 0;
  const keeps = (key: string) => fb?.artistKeep.get(key) ?? 0;

  const knownCount = input.seedTracks ?? Math.round(input.count * input.knownShare);
  const taken = new Set<string>();
  const result: Proposal[] = [];

  // --- Artistes que tu as déjà : leurs titres que tu n'as pas ---
  const known: Proposal[] = [];
  // Tes artistes les plus écoutés d'abord ; ceux dont tu passes souvent les titres, en dernier.
  const knownOrder = [...seedInfos].sort((a, b) => b.w * Math.pow(0.6, rejects(b.key)) - a.w * Math.pow(0.6, rejects(a.key)));
  for (const s of knownOrder) {
    if (known.length >= knownCount) break;
    if (!s.deezerId) continue;
    let tracks: dz.DzTrack[] = [];
    try { tracks = await cached(input, `top20:${s.deezerId}`, 3 * DAY, () => dz.topTracks(s.deezerId!, 20)); } catch { continue; }
    // Un titre par artiste écouté ; en découverte à la demande, plusieurs titres de l'artiste cherché.
    const perArtist = input.seedTracks ?? 1;
    for (let n = 0; n < perArtist && known.length < knownCount; n++) {
      const pick = pickTrack(input, tracks, s.deezerId, taken);
      if (!pick) break;
      const reason = input.seedTracks ? `De ${s.name}` : `Tu écoutes ${s.name}`;
      known.push(toProposal(pick.t, pick.id, pick.key, s.genre, reason, 'known'));
      taken.add(pick.key);
    }
  }

  // S'il manque des titres « connus », les nouveaux artistes complètent.
  const newCount = input.count - known.length;
  if (newCount <= 0) return known.slice(0, input.count);

  // --- Artistes nouveaux ---
  say('Recherche d’artistes proches');
  type Cand = { key: string; name: string; score: number; via: string; deezerId: number | null; mbid: string | null; both: number };
  const cands = new Map<string, Cand>();
  const blocked = input.blockedArtists ?? new Set<string>();
  const seedKeys = new Set(seeds.map((s) => s.key));
  const add = (name: string, sim: number, via: ArtistInfo & { w: number }, extra: Partial<Cand>) => {
    const key = artistKey(name);
    if (!key || seedKeys.has(key) || input.ownedArtists.has(key) || blocked.has(key)) return;
    const c = cands.get(key) ?? { key, name, score: 0, via: via.name, deezerId: null, mbid: null, both: 0 };
    const gain = via.w * sim;
    if (gain > c.score / 2) c.via = via.name;
    c.score += gain;
    c.both += 1;
    if (extra.deezerId) c.deezerId = extra.deezerId;
    if (extra.mbid) c.mbid = extra.mbid;
    cands.set(key, c);
  };

  for (const s of seedInfos.slice(0, Math.min(8, 2 + newCount))) {
    if (s.deezerId) {
      try {
        const rel = await cached(input, `rel:${s.deezerId}`, 14 * DAY, () => dz.related(s.deezerId!));
        rel.slice(0, 20).forEach((a, i) => add(a.name, 1 - i / 25, s, { deezerId: a.id }));
      } catch { /* Deezer muet pour cet artiste */ }
    }
    const withId = await withMbid(input, s);
    if (withId.mbid) {
      try {
        const sim = await cached(input, `sim:${withId.mbid}`, 14 * DAY, () => lb.similarArtists(withId.mbid!));
        const max = sim[0]?.score || 1;
        sim.slice(0, 30).forEach((a) => add(a.name, a.score / max, s, { mbid: a.mbid }));
      } catch { /* ListenBrainz indisponible */ }
    }
  }

  // Un artiste cité par les deux sources ou par plusieurs graines passe devant.
  const ranked = [...cands.values()]
    .map((c) => ({
      ...c,
      // Chaque « pas pour moi » fait reculer l'artiste (×0,6), chaque coup de cœur le fait monter,
      // et un artiste déjà proposé récemment laisse sa place.
      score:
        c.score *
        (c.both > 1 ? 1.3 : 1) *
        Math.pow(0.6, rejects(c.key)) *
        (1 + 0.3 * Math.min(keeps(c.key), 3)) *
        (keeps(c.key) > 0 ? 1 : Math.pow(0.6, input.recentArtists?.get(c.key) ?? 0)),
    }))
    .sort((a, b) => b.score - a.score);

  const quota = quotas(genreShare, newCount);
  const perSeed = new Map<string, number>();
  const maxPerSeed = Math.max(2, Math.ceil(newCount / 5));
  const leftovers: { p: Proposal }[] = [];
  let unknownGenre = 0;
  let looked = 0;

  say('Choix des titres');
  for (const c of ranked) {
    if (result.length >= newCount || looked >= Math.min(45, 8 + newCount * 4)) break;
    if ((perSeed.get(c.via) ?? 0) >= maxPerSeed) continue;
    looked += 1;
    const info = await resolve(input, c.name, { deezerId: c.deezerId, mbid: c.mbid });
    if (!info.deezerId) continue;
    let tracks: dz.DzTrack[] = [];
    try { tracks = await cached(input, `top15:${info.deezerId}`, 3 * DAY, () => dz.topTracks(info.deezerId!, 15)); } catch { continue; }
    const pick = pickTrack(input, tracks, info.deezerId, taken);
    if (!pick) continue;
    const p = toProposal(pick.t, pick.id, pick.key, info.genre, `Proche de ${c.via}`, 'new');
    const g = info.genre;
    const room = g ? (quota.get(g) ?? 0) : unknownGenre < 2 ? 1 : 0;
    if (room > 0) {
      if (g) quota.set(g, room - 1); else unknownGenre += 1;
      result.push(p);
      taken.add(pick.key);
      perSeed.set(c.via, (perSeed.get(c.via) ?? 0) + 1);
    } else {
      leftovers.push({ p });
    }
  }
  // Places restantes : les meilleurs candidats hors quota.
  for (const { p } of leftovers) {
    if (result.length >= newCount) break;
    if (taken.has(p.trackKey)) continue;
    result.push(p);
    taken.add(p.trackKey);
  }

  // Mélange : un titre « connu » tous les 3 environ.
  const out: Proposal[] = [];
  const step = known.length ? Math.max(2, Math.floor((result.length + known.length) / known.length)) : 0;
  let k = 0;
  for (const p of result) {
    out.push(p);
    if (step && out.length % step === step - 1 && k < known.length) out.push(known[k++]);
  }
  while (k < known.length) out.push(known[k++]);
  return out.slice(0, input.count);
}
