// « Cerveau » de ListenBrainz sans compte : artistes similaires calculés sur les écoutes de
// tous ses utilisateurs. Il faut l'identifiant MusicBrainz de l'artiste (MBID).
import { getJson } from './http';
import { artistKey } from './norm';

// MusicBrainz demande un User-Agent identifiable ; on reste générique.
const UA = { 'User-Agent': 'JukeBox/0.1 (personal music discovery app)', Accept: 'application/json' };

const ALGO = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';

type MbSearch = { artists?: { id: string; name: string; score: number }[]; error?: string };

export async function findMbid(name: string): Promise<string | null> {
  const q = encodeURIComponent(`artist:"${name.replace(/"/g, '')}"`);
  const res = await getJson<MbSearch>(`https://musicbrainz.org/ws/2/artist/?query=${q}&limit=3&fmt=json`, {
    service: 'musicbrainz',
    gapMs: 1100,
    headers: UA,
  });
  if (res.error || !res.artists) throw new Error(res.error ?? 'MusicBrainz indisponible');
  const key = artistKey(name);
  const hit = (res.artists ?? []).find((a) => a.score >= 90 && artistKey(a.name) === key);
  return hit?.id ?? null;
}

export type Similar = { mbid: string; name: string; score: number };

export async function similarArtists(mbid: string): Promise<Similar[]> {
  const url = `https://labs.api.listenbrainz.org/similar-artists/json?artist_mbids=${mbid}&algorithm=${ALGO}`;
  const res = await getJson<{ artist_mbid: string; name: string; score: number }[]>(url, {
    service: 'listenbrainz',
    gapMs: 300,
    headers: UA,
  });
  return (Array.isArray(res) ? res : []).map((r) => ({ mbid: r.artist_mbid, name: r.name, score: r.score }));
}

// --- Titres similaires (sans compte) ---

// Algorithme des « sessions d'écoute » : deux titres sont proches quand les mêmes gens les
// écoutent à la suite. Liste des valeurs permises : labs.api.listenbrainz.org/similar-recordings.
const REC_ALGO = 'session_based_days_9000_session_300_contribution_5_threshold_15_limit_50_skip_30';

/** Identifiants MusicBrainz d'un titre (plusieurs : une même chanson a souvent plusieurs enregistrements). */
export async function findRecordings(artist: string, title: string): Promise<string[]> {
  const clean = (t: string) => t.replace(/["\\]/g, '');
  const q = encodeURIComponent(`recording:"${clean(title)}" AND artist:"${clean(artist)}"`);
  const res = await getJson<{ recordings?: { id: string; score: number; title: string; 'artist-credit'?: { name: string }[] }[]; error?: string }>(
    `https://musicbrainz.org/ws/2/recording?query=${q}&limit=8&fmt=json`,
    { service: 'musicbrainz', gapMs: 1100, headers: UA },
  );
  if (res.error || !res.recordings) throw new Error(res.error ?? 'MusicBrainz indisponible');
  const key = artistKey(artist);
  return res.recordings
    .filter((r) => r.score >= 90 && artistKey(r['artist-credit']?.[0]?.name) === key)
    .map((r) => r.id)
    .slice(0, 4);
}

export type SimilarRecording = { mbid: string; title: string; artist: string; score: number };

export async function similarRecordings(mbid: string): Promise<SimilarRecording[]> {
  const url = `https://labs.api.listenbrainz.org/similar-recordings/json?recording_mbids=${mbid}&algorithm=${REC_ALGO}`;
  const res = await getJson<{ recording_mbid: string; recording_name: string; artist_credit_name: string; score: number }[]>(url, {
    service: 'listenbrainz',
    gapMs: 300,
    headers: UA,
  });
  return (Array.isArray(res) ? res : []).map((r) => ({ mbid: r.recording_mbid, title: r.recording_name, artist: r.artist_credit_name, score: r.score }));
}

// --- Ton compte (facultatif) ---
//
// Avec un jeton, JukeBox envoie tes écoutes complètes à ListenBrainz. En retour, ListenBrainz
// calcule chaque semaine des playlists faites pour toi (« Weekly Exploration ») à partir de ton
// historique et de celui des gens qui écoutent comme toi. Ton historique devient public sur ton
// profil ListenBrainz.

const API = 'https://api.listenbrainz.org/1';

export async function validateToken(token: string): Promise<string | null> {
  const res = await getJson<{ valid?: boolean; user_name?: string }>(`${API}/validate-token`, {
    service: 'listenbrainz-api',
    gapMs: 200,
    headers: { ...UA, Authorization: `Token ${token}` },
  });
  return res.valid && res.user_name ? res.user_name : null;
}

export type LbListen = { listenedAt: number; artist: string; title: string; album: string; durationMs: number; player: string };

export async function submitListens(token: string, listens: LbListen[]): Promise<void> {
  if (!listens.length) return;
  const payload = listens.map((l) => ({
    listened_at: Math.round(l.listenedAt / 1000),
    track_metadata: {
      artist_name: l.artist,
      track_name: l.title,
      ...(l.album ? { release_name: l.album } : {}),
      additional_info: {
        ...(l.durationMs > 0 ? { duration_ms: l.durationMs } : {}),
        media_player: l.player,
        submission_client: 'JukeBox',
      },
    },
  }));
  await getJson(`${API}/submit-listens`, {
    service: 'listenbrainz-api',
    gapMs: 200,
    headers: { ...UA, Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ listen_type: listens.length === 1 ? 'single' : 'import', payload }),
  });
}

export type LbTrack = { title: string; artist: string };

/** Ta dernière « Weekly Exploration » (vide tant que ListenBrainz n'a pas assez de tes écoutes). */
export async function weeklyExploration(user: string): Promise<{ title: string; tracks: LbTrack[] } | null> {
  type Jspf = { playlist: { title: string; identifier: string; date: string; track?: { title: string; creator: string }[] } };
  const list = await getJson<{ playlists?: Jspf[] }>(`${API}/user/${encodeURIComponent(user)}/playlists/createdfor?count=25`, {
    service: 'listenbrainz-api',
    gapMs: 200,
    headers: UA,
  });
  const latest = (list.playlists ?? [])
    .map((p) => p.playlist)
    .filter((p) => /weekly exploration/i.test(p.title))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!latest) return null;
  const id = latest.identifier.split('/').filter(Boolean).pop();
  const full = await getJson<Jspf>(`${API}/playlist/${id}`, { service: 'listenbrainz-api', gapMs: 200, headers: UA });
  return {
    title: latest.title,
    tracks: (full.playlist.track ?? []).map((t) => ({ title: t.title, artist: t.creator })),
  };
}
