// Base locale (SQLite) : écoutes, bibliothèque du téléphone, propositions, cache d'artistes.
import * as SQLite from 'expo-sqlite';
import type { ArtistCache, ArtistInfo, Memo } from './reco';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function db(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) dbPromise = open();
  return dbPromise;
}

async function open() {
  const d = await SQLite.openDatabaseAsync('jukebox.db');
  await d.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS listens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      title TEXT, artist TEXT, album TEXT,
      duration_ms INTEGER, played_ms INTEGER,
      pkg TEXT,
      kind TEXT NOT NULL,          -- listen | partial | skip
      artist_key TEXT, track_key TEXT
    );
    CREATE INDEX IF NOT EXISTS listens_time ON listens(started_at);
    CREATE INDEX IF NOT EXISTS listens_track ON listens(track_key);

    CREATE TABLE IF NOT EXISTS library (
      track_key TEXT PRIMARY KEY,
      artist_key TEXT, title TEXT, artist TEXT, album TEXT, uri TEXT, path TEXT
    );

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist TEXT NOT NULL, artist_key TEXT, artist TEXT, track_key TEXT
    );
    CREATE INDEX IF NOT EXISTS playlist_tracks_name ON playlist_tracks(playlist);

    CREATE TABLE IF NOT EXISTS artists (
      key TEXT PRIMARY KEY, name TEXT, deezer_id INTEGER, mbid TEXT, genre TEXT, checked_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,           -- identifiant Deezer du titre
      batch TEXT NOT NULL,           -- semaine (2026-11-16) ou recherche (search-…)
      source TEXT NOT NULL,          -- weekly | search
      position INTEGER,
      created_at INTEGER NOT NULL,
      title TEXT, artist TEXT, artist_key TEXT, track_key TEXT, album TEXT,
      duration_s INTEGER, cover TEXT, cover_medium TEXT, genre TEXT, reason TEXT, kind TEXT,
      deezer_artist_id INTEGER,
      decision TEXT,                 -- keep | have | reject
      decided_at INTEGER,
      dl_status TEXT,                -- queued | done | failed
      dl_error TEXT, uri TEXT, dl_at INTEGER,
      outcome TEXT,                  -- library | deleted
      outcome_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS proposals_batch ON proposals(batch);

    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);

    -- Réponses réseau gardées quelques jours (artistes proches, titres phares…).
    CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  await migrate(d);
  return d;
}

/** Colonnes ajoutées après la première version (la base du téléphone est gardée telle quelle). */
async function migrate(d: SQLite.SQLiteDatabase) {
  const cols = new Set((await d.getAllAsync<{ name: string }>('PRAGMA table_info(proposals)')).map((c) => c.name));
  // Secondes d'extrait écoutées avant de trier, et passage par YouTube : un « non » au bout de
  // 3 secondes n'a pas le poids d'un « non » au bout de 28.
  if (!cols.has('heard_s')) await d.execAsync('ALTER TABLE proposals ADD COLUMN heard_s INTEGER');
  if (!cols.has('youtube')) await d.execAsync('ALTER TABLE proposals ADD COLUMN youtube INTEGER');
}

// Une seule transaction à la fois. expo-sqlite partage une connexion : si deux transactions
// se croisent (deux rafraîchissements lancés ensemble), le second BEGIN échoue et son ROLLBACK
// annule le travail du premier (« cannot rollback - no transaction is active »).
let queue: Promise<unknown> = Promise.resolve();

export function transaction(task: (d: SQLite.SQLiteDatabase) => Promise<void>): Promise<void> {
  const run = async () => {
    const d = await db();
    await d.withTransactionAsync(() => task(d));
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

export async function getMeta(key: string): Promise<string | null> {
  const row = await (await db()).getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string) {
  await (await db()).runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', key, value);
}

export const artistCache: ArtistCache = {
  async get(key) {
    const r = await (await db()).getFirstAsync<{
      key: string; name: string; deezer_id: number | null; mbid: string | null; genre: string | null; checked_at: number;
    }>('SELECT * FROM artists WHERE key = ?', key);
    if (!r) return undefined;
    return { key: r.key, name: r.name, deezerId: r.deezer_id, mbid: r.mbid, genre: r.genre, checkedAt: r.checked_at };
  },
  async set(i: ArtistInfo) {
    await (await db()).runAsync(
      'INSERT OR REPLACE INTO artists (key, name, deezer_id, mbid, genre, checked_at) VALUES (?, ?, ?, ?, ?, ?)',
      i.key, i.name, i.deezerId, i.mbid, i.genre, i.checkedAt,
    );
  },
};

/** keep : je garde et je télécharge ; have : j'aime mais je l'ai déjà ; reject : pas pour moi. */
export type Decision = 'keep' | 'reject' | 'have';

export type ProposalRow = {
  id: string;
  batch: string;
  source: string;
  position: number;
  created_at: number;
  title: string;
  artist: string;
  artist_key: string;
  track_key: string;
  album: string;
  duration_s: number;
  cover: string;
  cover_medium: string;
  genre: string | null;
  reason: string;
  kind: string;
  deezer_artist_id: number;
  decision: Decision | null;
  decided_at: number | null;
  dl_status: 'queued' | 'done' | 'failed' | null;
  dl_error: string | null;
  uri: string | null;
  dl_at: number | null;
  outcome: 'library' | 'deleted' | null;
  outcome_at: number | null;
  heard_s: number | null;
  youtube: number | null;
};

export const memo: Memo = {
  async get(key, maxAgeMs) {
    const r = await (await db()).getFirstAsync<{ value: string; at: number }>('SELECT value, at FROM cache WHERE key = ?', key);
    return r && Date.now() - r.at < maxAgeMs ? r.value : null;
  },
  async set(key, value) {
    await (await db()).runAsync('INSERT OR REPLACE INTO cache (key, value, at) VALUES (?, ?, ?)', key, value, Date.now());
  },
};
