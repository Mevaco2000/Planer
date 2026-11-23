export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.floor(n));
  if (!Number.isInteger(n)) return few;
  if (abs === 1) return one;
  const d = abs % 10;
  const t = abs % 100;
  if (d >= 2 && d <= 4 && (t < 12 || t > 14)) return few;
  return many;
}

/** Tekst bez polskich znaków i wielkości liter – do wyszukiwania. */
export function searchKey(s: string): string {
  return s.toLowerCase().replace(/ł/g, 'l').normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * Jak searchKey, ale znak po znaku – wynik ma dokładnie tę samą długość co wejście,
 * więc pozycje dopasowań w tekście uproszczonym wskazują ten sam fragment oryginału.
 */
export function fold(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    let f = c.toLowerCase();
    if (f === 'ł') f = 'l';
    else {
      const d = f.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (d.length === 1) f = d;
    }
    out += f.length === 1 ? f : c;
  }
  return out;
}

export function matches(query: string, text: string): boolean {
  const q = searchKey(query.trim());
  if (!q) return true;
  const t = searchKey(text);
  return q.split(/\s+/).every((w) => t.includes(w));
}

export function newKey(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
