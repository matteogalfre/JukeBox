// Essai du moteur depuis le Mac : npx tsx scripts/essai-reco.ts "Artiste 1" "Artiste 2" ...
import { recommend, type ArtistInfo } from '../src/lib/reco.ts';
import { artistKey } from '../src/lib/norm.ts';

// "Artiste" ou "Artiste:poids"
const args = process.argv.slice(2).map((a, i, all) => { const [n, w] = a.split(':'); return { n, w: w ? Number(w) : all.length - i }; });
const names = args.map((a) => a.n);
const mem = new Map<string, ArtistInfo>();
const t0 = Date.now();
const out = await recommend({
  seeds: args.map((a) => ({ key: artistKey(a.n), name: a.n, weight: a.w })),
  ownedArtists: new Set(names.map(artistKey)),
  ownedTracks: new Set(),
  excludedTracks: new Set(),
  excludedIds: new Set(),
  cache: { get: async (k) => mem.get(k), set: async (i) => void mem.set(i.key, i) },
  count: 15,
  knownShare: 0.3,
  onProgress: (m) => console.log('…', m),
});
console.log('genres graines :', names.map((n) => `${n}=${mem.get(artistKey(n))?.genre}`).join(', '));
for (const p of out) console.log(`${p.kind === 'new' ? 'NEW ' : 'DÉJÀ'} ${p.artist} — ${p.title} [${p.genre}] (${p.reason})`);
console.log(out.length, 'titres en', Math.round((Date.now() - t0) / 1000), 's');
