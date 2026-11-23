// Weryfikacja tokenu Firebase (ID token, RS256) bez Admin SDK – klucze publiczne Google, sprawdzenie podpisu i pól.
import { fromB64url, utf8 } from './bytes';

export const GOOGLE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

export class AuthError extends Error {}

interface Jwks {
  keys: Map<string, CryptoKey>;
  expires: number;
}

let cache: { url: string; jwks: Jwks } | null = null;

/** Do testów: wyczyszczenie zapamiętanych kluczy. */
export const resetJwksCache = () => {
  cache = null;
};

async function loadJwks(url: string, fetchImpl: typeof fetch, now: number): Promise<Jwks> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Klucze Firebase niedostępne (${res.status})`);
  const data = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of data.keys ?? []) {
    if (!k.kid || k.kty !== 'RSA') continue;
    keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  const maxAge = Number(/max-age=(\d+)/.exec(res.headers.get('Cache-Control') ?? '')?.[1] ?? 3600);
  return { keys, expires: now + Math.min(maxAge, 6 * 3600) * 1000 };
}

async function keyFor(kid: string, url: string, fetchImpl: typeof fetch, now: number): Promise<CryptoKey | undefined> {
  if (!cache || cache.url !== url || cache.jwks.expires < now || !cache.jwks.keys.has(kid)) {
    cache = { url, jwks: await loadJwks(url, fetchImpl, now) };
  }
  return cache.jwks.keys.get(kid);
}

const decode = <T>(part: string): T => JSON.parse(new TextDecoder().decode(fromB64url(part))) as T;

/** Zwraca uid zalogowanego użytkownika albo rzuca AuthError. */
export async function verifyFirebaseToken(
  token: string,
  projectId: string,
  opts: { jwksUrl?: string; now?: number; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const now = opts.now ?? Date.now();
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Nieprawidłowy token');
  let header: { alg?: string; kid?: string };
  let claims: { aud?: string; iss?: string; sub?: string; exp?: number; iat?: number; auth_time?: number };
  try {
    header = decode(parts[0]);
    claims = decode(parts[1]);
  } catch {
    throw new AuthError('Nieprawidłowy token');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new AuthError('Nieprawidłowy token');
  const sec = Math.floor(now / 1000);
  if (claims.aud !== projectId || claims.iss !== `https://securetoken.google.com/${projectId}`) throw new AuthError('Token z innego projektu');
  if (typeof claims.exp !== 'number' || claims.exp <= sec) throw new AuthError('Token wygasł');
  if (typeof claims.iat !== 'number' || claims.iat > sec + 300) throw new AuthError('Nieprawidłowy token');
  if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128) throw new AuthError('Nieprawidłowy token');

  const key = await keyFor(header.kid, opts.jwksUrl ?? GOOGLE_JWKS, opts.fetchImpl ?? fetch, now);
  if (!key) throw new AuthError('Nieznany klucz tokenu');
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(parts[2]), utf8(`${parts[0]}.${parts[1]}`));
  if (!ok) throw new AuthError('Nieprawidłowy podpis tokenu');
  return claims.sub;
}
