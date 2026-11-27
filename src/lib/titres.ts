// Propositions titre par titre, en plus de celles par artiste de reco.ts :
// - ce que les gens écoutent juste après tes titres préférés (ListenBrainz, sans compte) ;
// - ta « Weekly Exploration » si tu as relié ton compte ListenBrainz.
import * as dz from './deezer';
import { DAY } from './gout';
import * as lb from './listenbrainz';
import { artistKey, trackKey } from './norm';
import { allowed, cached, resolve, toProposal, type Proposal, type RecoInput } from './reco';

export type TrackRef = { artist: string; title: string; weight: number };

type Ctx = Omit<RecoInput, 'seeds' | 'count' | 'knownShare' | 'seedTracks'>;

type Cand = { artist: string; title: string; score: number; reason: string };

/**
 * Les énormes tubes s'écoutent après tout et n'importe quoi : leur note est divisée selon leur
 * popularité Deezer (rang 100 000 = neutre, 1 000 000 = divisé par 2,5 environ).
 */
export function popularityPenalty(rank: number | undefined): number {
  return Math.pow(Math.max(rank ?? 0, 100_000) / 100_000, -0.4);
}

/**
 * Va chercher sur Deezer les meilleurs candidats (trois fois plus que demandé), les reclasse en
 * pénalisant les tubes, puis garde un titre par artiste et au plus `perReason` par titre de départ.
 */
async function realize(ctx: Ctx, cands: Cand[], count: number, genres: Set<string> | null, perReason = count): Promise<Proposal[]> {
  const found: { p: Proposal; score: number; reason: string }[] = [];
  const taken = new Set<string>();
  const artists = new Set<string>();
  const blocked = ctx.blockedArtists ?? new Set<string>();
  let looked = 0;
  for (const c of cands) {
    if (found.length >= count * 3 || looked >= count * 6 + 6) break;
    const aKey = artistKey(c.artist);
    if (!aKey || artists.has(aKey) || blocked.has(aKey)) continue;
    const key = trackKey(c.artist, c.title);
    if (ctx.excludedTracks.has(key) || ctx.ownedTracks.has(key)) continue;
    looked += 1;
    let t: dz.DzTrack | null = null;
    try {
      t = await cached(ctx, `dzt:${key}`, 30 * DAY, () => dz.searchTrack(c.artist, c.title));
    } catch {
      continue;
    }
    if (!t) continue;
    const ok = allowed(ctx, t, taken);
    if (!ok) continue;
    const info = await resolve(ctx, t.artist.name, { deezerId: t.artist.id });
    // Hors de tes styles (ListenBrainz mélange parfois tout) : on passe.
    if (genres && info.genre && !genres.has(info.genre)) continue;
    const kind = ctx.ownedArtists.has(artistKey(t.artist.name)) ? 'known' : 'new';
    found.push({ p: toProposal(t, ok.id, ok.key, info.genre, c.reason, kind), score: c.score * popularityPenalty(t.rank), reason: c.reason });
    taken.add(ok.key);
    artists.add(aKey);
  }
  const out: Proposal[] = [];
  const perRef = new Map<string, number>();
  for (const f of found.sort((a, b) => b.score - a.score)) {
    if (out.length >= count) break;
    if ((perRef.get(f.reason) ?? 0) >= perReason) continue;
    perRef.set(f.reason, (perRef.get(f.reason) ?? 0) + 1);
    out.push(f.p);
  }
  return out;
}

/**
 * Titres qui s'écoutent à la suite de tes préférés, chez les utilisateurs de ListenBrainz.
 * `genres` : tes styles, pour écarter ce qui n'a rien à voir (null = pas de filtre).
 */
export async function similarTracks(ctx: Ctx, refs: TrackRef[], count: number, genres: Set<string> | null): Promise<Proposal[]> {
  if (count <= 0 || !refs.length) return [];
  const pool = new Map<string, Cand & { best: number }>();
  for (const ref of refs) {
    let ids: string[] = [];
    try {
      ids = await cached(ctx, `rec:${trackKey(ref.artist, ref.title)}`, 90 * DAY, () => lb.findRecordings(ref.artist, ref.title));
    } catch {
      continue; // MusicBrainz saturé : on fera sans ce titre-là
    }
    // Une chanson a plusieurs enregistrements ; on prend le premier que ListenBrainz connaît.
    let sims: lb.SimilarRecording[] = [];
    for (const id of ids) {
      try {
        sims = await cached(ctx, `simrec:${id}`, 14 * DAY, () => lb.similarRecordings(id));
      } catch {
        sims = [];
      }
      if (sims.length) break;
    }
    const max = sims[0]?.score || 1;
    const refArtist = artistKey(ref.artist);
    for (const s of sims.slice(0, 30)) {
      if (artistKey(s.artist) === refArtist) continue; // le même artiste : pas une découverte
      const key = trackKey(s.artist, s.title);
      const gain = ref.weight * (s.score / max);
      const c = pool.get(key) ?? { artist: s.artist, title: s.title, score: 0, best: 0, reason: '' };
      c.score += gain;
      if (gain > c.best) {
        c.best = gain;
        c.reason = `Dans la lignée de « ${ref.title} »`;
      }
      pool.set(key, c);
    }
  }
  const ranked = [...pool.values()].sort((a, b) => b.score - a.score);
  // Un même titre de départ ne prend pas toute la place.
  return realize(ctx, ranked, count, genres, Math.max(2, Math.ceil(count / refs.length) + 1));
}

/** Ta dernière Weekly Exploration ListenBrainz (calculée sur ton historique). */
export async function exploration(ctx: Ctx, user: string, count: number): Promise<Proposal[]> {
  if (count <= 0) return [];
  const pl = await cached(ctx, `lbx:${user}`, DAY / 2, () => lb.weeklyExploration(user));
  if (!pl?.tracks.length) return [];
  const cands = pl.tracks.map((t, i) => ({ artist: t.artist, title: t.title, score: pl.tracks.length - i, reason: 'Weekly Exploration · ListenBrainz' }));
  return realize(ctx, cands, count, null);
}
