// Ce que ton tri et tes écoutes disent de tes goûts. Fonctions pures, testées depuis le Mac
// (npm test).

export const DAY = 24 * 3600 * 1000;

/** Poids d'un événement selon son âge : 1 aujourd'hui, 0,5 au bout de `halfLifeDays`. */
export function decay(at: number, halfLifeDays: number, now = Date.now()): number {
  return Math.pow(0.5, Math.max(0, now - at) / (halfLifeDays * DAY));
}

/** Ce qu'on sait d'un titre proposé une fois trié. */
export type Verdict = {
  decision: string;
  /** Secondes d'extrait écoutées avant de trier (null avant la 0.2). */
  heardS: number | null;
  youtube: boolean;
  /** Le lundi suivant : rangé dans ta bibliothèque, ou supprimé faute d'écoute. */
  outcome: string | null;
  /** Écoutes complètes dans Samsung Music après le tri. */
  fullListens: number;
};

/**
 * Note d'un titre proposé : positive si tu l'aimes, négative sinon.
 * - garder ou « j'ai déjà » : +1 ; passer : de -1,5 (au bout de 3 s) à -0,5 (extrait écouté presque en entier) ;
 * - ouvert sur YouTube : +0,5 (ça t'a intrigué) ;
 * - chaque écoute complète ensuite : +0,5 (jusqu'à 3) ;
 * - rangé dans ta bibliothèque : +1,5 ; supprimé sans avoir été écouté : -0,5.
 */
export function verdictScore(v: Verdict): number {
  let s: number;
  if (v.decision === 'reject') s = v.heardS == null ? -1 : v.heardS < 6 ? -1.5 : v.heardS < 20 ? -1 : -0.5;
  else s = 1;
  if (v.youtube) s += 0.5;
  s += 0.5 * Math.min(v.fullListens, 3);
  if (v.outcome === 'library') s += 1.5;
  else if (v.outcome === 'deleted') s -= 0.5;
  return s;
}

/** Valeur d'une écoute Samsung Music selon qu'elle est complète, partielle ou passée. */
export function listenValue(kind: string): number {
  return kind === 'listen' ? 1 : kind === 'partial' ? 0.4 : -0.3;
}

/** Facteur de genre : 1 = neutre, jusqu'à 0,2 si tu le passes souvent, 1,8 si tu le gardes. */
export function genreFactor(keep: number, reject: number): number {
  const f = (2 * (keep + 1)) / (keep + reject + 2);
  return Math.min(1.8, Math.max(0.2, f));
}

/** Un artiste nettement plus passé que gardé n'est plus proposé comme « nouveau ». */
export function isBlocked(keep: number, reject: number): boolean {
  return reject - keep >= 2;
}

/**
 * Tirage pondéré sans remise : les plus gros poids sortent le plus souvent, sans que ce soient
 * toujours les mêmes d'une semaine à l'autre.
 */
export function weightedSample<T>(items: T[], weight: (t: T) => number, n: number, rand: () => number = Math.random): T[] {
  return items
    .map((t) => ({ t, k: Math.pow(rand(), 1 / Math.max(weight(t), 1e-6)) }))
    .sort((a, b) => b.k - a.k)
    .slice(0, n)
    .map((x) => x.t);
}

/** Les `keep` premiers restent, le reste est tiré au sort parmi les `pool` suivants. */
export function rotate<T>(sorted: T[], weight: (t: T) => number, keep: number, n: number, pool: number, rand: () => number = Math.random): T[] {
  const head = sorted.slice(0, Math.min(keep, n));
  const tail = weightedSample(sorted.slice(head.length, head.length + pool), weight, n - head.length, rand);
  return [...head, ...tail];
}
