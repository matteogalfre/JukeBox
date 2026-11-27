// Requêtes JSON avec une file par service, pour respecter les limites de chacun
// (MusicBrainz : 1 requête par seconde ; Deezer : 50 requêtes / 5 s).

type Queue = { gapMs: number; last: number; chain: Promise<unknown> };

const queues: Record<string, Queue> = {};

function queue(name: string, gapMs: number): Queue {
  if (!queues[name]) queues[name] = { gapMs, last: 0, chain: Promise.resolve() };
  return queues[name];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function getJson<T>(
  url: string,
  opts: { service: string; gapMs: number; headers?: Record<string, string>; retries?: number; body?: string },
): Promise<T> {
  const q = queue(opts.service, opts.gapMs);
  const run = async (): Promise<T> => {
    const wait = q.last + q.gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    q.last = Date.now();
    let attempt = 0;
    for (;;) {
      try {
        const res = await fetch(url, { method: opts.body ? 'POST' : 'GET', headers: opts.headers, body: opts.body });
        if (res.status === 429 || res.status === 503) throw new Error(`HTTP ${res.status}`);
        if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
        return (await res.json()) as T;
      } catch (e) {
        attempt += 1;
        if ((e as { fatal?: boolean }).fatal || attempt > (opts.retries ?? 2)) throw e;
        await sleep(1000 * attempt * attempt);
      }
    }
  };
  const p = q.chain.then(run, run);
  q.chain = p.catch(() => undefined);
  return p;
}
