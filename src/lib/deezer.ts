// API publique Deezer : sans clé ni compte. Sert à trouver les titres phares d'un artiste,
// leur genre, leur pochette et l'extrait de 30 secondes.
import { getJson } from './http';
import { artistKey, titleKey } from './norm';

const BASE = 'https://api.deezer.com';
const get = <T>(path: string) => getJson<T>(BASE + path, { service: 'deezer', gapMs: 110 });

export type DzArtist = { id: number; name: string; nb_fan?: number; picture_medium?: string };
export type DzTrack = {
  id: number;
  title: string;
  title_version?: string;
  duration: number;
  rank?: number;
  preview: string;
  readable?: boolean;
  track_position?: number;
  release_date?: string;
  artist: { id: number; name: string };
  album: { id: number; title: string; cover_medium?: string; cover_xl?: string; release_date?: string };
};
type List<T> = { data?: T[]; error?: unknown };

export async function searchArtist(name: string): Promise<DzArtist | null> {
  const res = await get<List<DzArtist>>(`/search/artist?q=${encodeURIComponent(name)}&limit=25`);
  const key = artistKey(name);
  // Deezer classe mal : des homonymes à 100 fans passent avant l'artiste connu.
  // On garde les noms identiques et on prend le plus suivi.
  const same = (res.data ?? []).filter((a) => artistKey(a.name) === key);
  same.sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0));
  return same[0] ?? null;
}

export async function searchAny(query: string): Promise<{ artists: DzArtist[]; tracks: DzTrack[] }> {
  const [a, t] = await Promise.all([
    get<List<DzArtist>>(`/search/artist?q=${encodeURIComponent(query)}&limit=5`),
    get<List<DzTrack>>(`/search?q=${encodeURIComponent(query)}&limit=5`),
  ]);
  return { artists: a.data ?? [], tracks: t.data ?? [] };
}

export async function topTracks(artistId: number, limit = 15): Promise<DzTrack[]> {
  const res = await get<List<DzTrack>>(`/artist/${artistId}/top?limit=${limit}`);
  return res.data ?? [];
}

export async function related(artistId: number): Promise<DzArtist[]> {
  const res = await get<List<DzArtist>>(`/artist/${artistId}/related?limit=25`);
  return res.data ?? [];
}

export async function track(id: number | string): Promise<DzTrack | null> {
  const res = await get<DzTrack & { error?: unknown }>(`/track/${id}`);
  return res.error ? null : res;
}

type DzAlbum = { genres?: { data?: { name: string }[] }; release_date?: string };

/** Genre principal d'un artiste, d'après l'album de son titre le plus écouté. */
export async function artistGenre(artistId: number): Promise<string | null> {
  const top = await topTracks(artistId, 1);
  const albumId = top[0]?.album?.id;
  if (!albumId) return null;
  const album = await get<DzAlbum>(`/album/${albumId}`);
  return album.genres?.data?.[0]?.name ?? null;
}

/** Un titre précis (artiste + titre), en comparant les noms sans accents ni « feat. ». */
export async function searchTrack(artist: string, title: string): Promise<DzTrack | null> {
  const q = encodeURIComponent(`artist:"${artist.replace(/"/g, '')}" track:"${title.replace(/"/g, '')}"`);
  const res = await get<List<DzTrack>>(`/search?q=${q}&limit=10`);
  const a = artistKey(artist);
  const t = titleKey(title);
  const same = (res.data ?? []).filter((x) => artistKey(x.artist?.name) === a && titleKey(x.title) === t);
  return same.find((x) => x.readable !== false && x.preview) ?? null;
}
