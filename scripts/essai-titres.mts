// Essai des titres similaires depuis le Mac : npx tsx scripts/essai-titres.mts "Artiste - Titre" ...
import { artistKey } from '../src/lib/norm.ts';
import type { ArtistInfo } from '../src/lib/reco.ts';
import { similarTracks } from '../src/lib/titres.ts';

const refs = process.argv.slice(2).map((a, i, all) => {
  const [artist, title] = a.split(' - ');
  return { artist, title, weight: all.length - i };
});
const mem = new Map<string, ArtistInfo>();
const t0 = Date.now();
const out = await similarTracks(
  {
    ownedArtists: new Set(refs.map((r) => artistKey(r.artist))),
    ownedTracks: new Set(),
    excludedTracks: new Set(),
    excludedIds: new Set(),
    cache: { get: async (k) => mem.get(k), set: async (i) => void mem.set(i.key, i) },
  },
  refs,
  8,
  process.env.GENRES ? new Set(process.env.GENRES.split(',')) : null,
);
for (const p of out) console.log(`${p.kind === 'new' ? 'NEW ' : 'DÉJÀ'} ${p.artist} : ${p.title} [${p.genre}] (${p.reason})`);
console.log(out.length, 'titres en', Math.round((Date.now() - t0) / 1000), 's');
