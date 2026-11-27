// Normalisation des noms pour comparer ce que joue Samsung Music, ce qu'il y a sur le
// téléphone et ce que renvoient Deezer / ListenBrainz (accents, feat., versions...).

export function fold(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const SEPARATORS = /\s*(?:,|;|\/|&|\bfeat\.?|\bft\.?|\bfeaturing\b|\bx\b|\bet\b|\band\b|\bwith\b)\s*/i;

/** Artiste principal, sans accents ni casse (« Orelsan feat. Stromae » → « orelsan »). */
export function artistKey(artist: string | null | undefined): string {
  const first = (artist ?? '').split(SEPARATORS)[0] ?? '';
  return fold(first)
    .replace(/^the\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Titre sans parenthèses, feat., remaster, etc. */
export function titleKey(title: string | null | undefined): string {
  return fold(title)
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\b(feat|ft|featuring)\.?\s.*$/, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function trackKey(artist: string | null | undefined, title: string | null | undefined): string {
  return `${artistKey(artist)}|${titleKey(title)}`;
}

const LIVE = /\b(live|en direct|en concert|concert|unplugged|live at|live from|session live)\b/i;

/** Version live (titre, version ou album). */
export function isLive(...parts: (string | null | undefined)[]): boolean {
  return parts.some((p) => !!p && LIVE.test(p));
}

/** Semaine au format « 2026-11-16 » (date du lundi, heure locale). */
export function weekKey(date = new Date()): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - day);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const j = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${j}`;
}
