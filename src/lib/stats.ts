// Statistiques d'écoute et bilan des découvertes.
import { db } from './db';

export type Period = 'week' | 'month' | 'all';
const DAY = 24 * 3600 * 1000;

export function since(period: Period): number {
  if (period === 'week') return Date.now() - 7 * DAY;
  if (period === 'month') return Date.now() - 30 * DAY;
  return 0;
}

export type TopRow = { label: string; sub?: string; count: number };

export async function topTracks(period: Period, limit = 10): Promise<TopRow[]> {
  const rows = await (await db()).getAllAsync<{ title: string; artist: string; n: number }>(
    `SELECT MAX(title) AS title, MAX(artist) AS artist, COUNT(*) AS n FROM listens
      WHERE kind = 'listen' AND started_at >= ? GROUP BY track_key ORDER BY n DESC LIMIT ?`,
    since(period), limit,
  );
  return rows.map((r) => ({ label: r.title, sub: r.artist, count: r.n }));
}

export async function topArtists(period: Period, limit = 10): Promise<TopRow[]> {
  const rows = await (await db()).getAllAsync<{ artist: string; n: number }>(
    `SELECT MAX(artist) AS artist, COUNT(*) AS n FROM listens
      WHERE kind = 'listen' AND started_at >= ? AND artist_key != '' GROUP BY artist_key ORDER BY n DESC LIMIT ?`,
    since(period), limit,
  );
  return rows.map((r) => ({ label: r.artist, count: r.n }));
}

export type Habits = {
  totalMs: number;
  listens: number;
  skips: number;
  byHour: number[];
  byWeekday: number[]; // lundi = 0
};

export async function habits(period: Period): Promise<Habits> {
  const rows = await (await db()).getAllAsync<{ started_at: number; played_ms: number; kind: string }>(
    'SELECT started_at, played_ms, kind FROM listens WHERE started_at >= ?',
    since(period),
  );
  const h: Habits = { totalMs: 0, listens: 0, skips: 0, byHour: Array(24).fill(0), byWeekday: Array(7).fill(0) };
  for (const r of rows) {
    h.totalMs += r.played_ms;
    if (r.kind === 'listen') h.listens += 1;
    if (r.kind === 'skip') h.skips += 1;
    const d = new Date(r.started_at);
    h.byHour[d.getHours()] += r.played_ms;
    h.byWeekday[(d.getDay() + 6) % 7] += r.played_ms;
  }
  return h;
}

export type DiscoveryReport = {
  proposed: number;
  kept: number;
  rejected: number;
  downloaded: number;
  listenedAfter: number;
  inLibrary: number;
  deleted: number;
};

export async function discoveryReport(period: Period): Promise<DiscoveryReport> {
  const d = await db();
  const s = since(period);
  const r = await d.getFirstAsync<DiscoveryReport>(
    `SELECT COUNT(*) AS proposed,
            SUM(decision IN ('keep', 'have')) AS kept,
            SUM(decision = 'reject') AS rejected,
            SUM(dl_status = 'done') AS downloaded,
            SUM(outcome = 'library') AS inLibrary,
            SUM(outcome = 'deleted') AS deleted,
            0 AS listenedAfter
       FROM proposals WHERE created_at >= ?`,
    s,
  );
  const listened = await d.getFirstAsync<{ n: number }>(
    `SELECT COUNT(DISTINCT p.id) AS n FROM proposals p
       JOIN listens l ON l.track_key = p.track_key AND l.kind = 'listen' AND l.started_at >= COALESCE(p.dl_at, 0)
      WHERE p.dl_status = 'done' AND p.created_at >= ?`,
    s,
  );
  return {
    proposed: r?.proposed ?? 0,
    kept: r?.kept ?? 0,
    rejected: r?.rejected ?? 0,
    downloaded: r?.downloaded ?? 0,
    listenedAfter: listened?.n ?? 0,
    inLibrary: r?.inLibrary ?? 0,
    deleted: r?.deleted ?? 0,
  };
}
