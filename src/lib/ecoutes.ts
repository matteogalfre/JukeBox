// Récupère les écoutes notées par le service Android et la musique du téléphone.
import Ecoute from '../../modules/ecoute';
import { getMeta, setMeta, transaction } from './db';
import { artistKey, trackKey } from './norm';

type RawListen = {
  startedAt: number;
  endedAt: number;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  playedMs: number;
  pkg: string;
};

/** Écoute complète : la moitié du titre ou 4 minutes. Passé : moins de 30 s. */
export function classify(playedMs: number, durationMs: number): 'listen' | 'partial' | 'skip' {
  if (playedMs < 30_000) return 'skip';
  if (durationMs > 0 ? playedMs >= Math.min(durationMs / 2, 240_000) : playedMs >= 60_000) return 'listen';
  return 'partial';
}

const UNKNOWN = /^(<unknown>|unknown|inconnu|artiste inconnu|)$/i;

export async function importListens(): Promise<number> {
  if (!Ecoute) return 0;
  // Le fichier du service est vidé à la lecture : si l'enregistrement échoue, les lignes sont
  // gardées de côté et reprises au passage suivant, pour ne perdre aucune écoute.
  const text = ((await getMeta('listens_pending')) ?? '') + Ecoute.drain();
  if (!text) return 0;
  const rows = text
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l) as RawListen; } catch { return null; }
    })
    .filter((r): r is RawListen => !!r);
  try {
    await transaction(async (d) => {
      for (const r of rows) {
        const artist = UNKNOWN.test(r.artist.trim()) ? '' : r.artist;
        await d.runAsync(
          `INSERT INTO listens (started_at, ended_at, title, artist, album, duration_ms, played_ms, pkg, kind, artist_key, track_key)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.startedAt, r.endedAt, r.title, artist, r.album, r.durationMs, r.playedMs, r.pkg,
          classify(r.playedMs, r.durationMs), artistKey(artist), trackKey(artist, r.title),
        );
      }
    });
  } catch (e) {
    await setMeta('listens_pending', text).catch(() => undefined);
    throw e;
  }
  await setMeta('listens_pending', '');
  return rows.length;
}

export async function syncLibrary(): Promise<number> {
  if (!Ecoute) return 0;
  const tracks = await Ecoute.library();
  await transaction(async (d) => {
    await d.runAsync('DELETE FROM library');
    for (const t of tracks) {
      const artist = UNKNOWN.test((t.artist ?? '').trim()) ? '' : t.artist ?? '';
      await d.runAsync(
        'INSERT OR REPLACE INTO library (track_key, artist_key, title, artist, album, uri, path) VALUES (?, ?, ?, ?, ?, ?, ?)',
        trackKey(artist, t.title), artistKey(artist), t.title, artist, t.album, t.uri, t.path,
      );
    }
  });
  return tracks.length;
}

/** Tes playlists (Rap FR, Chill…) : elles disent quels styles tu aimes et dans quelles proportions. */
export async function syncPlaylists(): Promise<number> {
  if (!Ecoute) return 0;
  const lists = await Ecoute.playlists();
  await transaction(async (d) => {
    await d.runAsync('DELETE FROM playlist_tracks');
    for (const pl of lists) {
      for (const t of pl.tracks) {
        const artist = UNKNOWN.test((t.artist ?? '').trim()) ? '' : t.artist ?? '';
        if (!artist) continue;
        await d.runAsync(
          'INSERT INTO playlist_tracks (playlist, artist_key, artist, track_key) VALUES (?, ?, ?, ?)',
          pl.name, artistKey(artist), artist, trackKey(artist, t.title),
        );
      }
    }
  });
  return lists.length;
}
