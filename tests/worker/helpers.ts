// Pomocnicze do testów Workera: D1 na node:sqlite, odszyfrowanie Web Push „po stronie przeglądarki”, klucze i tokeny.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { b64url, concat, fromB64url, utf8, type Bytes } from '../../worker/src/bytes';
import type { D1Database, D1PreparedStatement } from '../../worker/src/types';

export function fakeD1(): D1Database & { raw: DatabaseSync } {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../worker/migrations/0001_init.sql', import.meta.url), 'utf8'));
  const prepare = (sql: string, args: unknown[] = []): D1PreparedStatement => ({
    bind: (...values: unknown[]) => prepare(sql, values),
    all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[], success: true, meta: {} }),
    first: async <T>() => (db.prepare(sql).get(...(args as never[])) as T | undefined) ?? null,
    run: async () => {
      const meta = db.prepare(sql).run(...(args as never[]));
      return { results: [], success: true, meta };
    },
  });
  return {
    raw: db,
    prepare,
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Odszyfrowanie aes128gcm tak, jak robi to przeglądarka (klucz prywatny subskrypcji). */
export async function decryptPush(body: Bytes, ua: { privateJwk: JsonWebKey; publicRaw: Bytes; auth: Bytes }): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const uaPrivate = await crypto.subtle.importKey('jwk', ua.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const ikm = await hkdf(ua.auth, ecdh, concat(utf8('WebPush: info\0'), ua.publicRaw, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  let end = plain.length - 1;
  while (end >= 0 && plain[end] === 0) end--;
  if (plain[end] !== 2) throw new Error('Brak znacznika ostatniego rekordu');
  return new TextDecoder().decode(plain.slice(0, end));
}

/** Subskrypcja „przeglądarki”: klucze ECDH i sekret auth. */
export async function browserSubscription(endpoint: string) {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    json: { endpoint, keys: { p256dh: b64url(publicRaw), auth: b64url(auth) } },
    ua: { privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey), publicRaw, auth },
  };
}

export async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: b64url(await crypto.subtle.exportKey('raw', pair.publicKey)), privateKey: jwk.d!, verifyKey: pair.publicKey };
}

/** „Google”: klucz RSA do podpisywania tokenów Firebase i jego JWKS. */
export async function firebaseSigner(kid = 'key-1') {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const sign = async (claims: Record<string, unknown>, headerKid = kid) => {
    const h = b64url(utf8(JSON.stringify({ alg: 'RS256', kid: headerKid, typ: 'JWT' })));
    const p = b64url(utf8(JSON.stringify(claims)));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, utf8(`${h}.${p}`));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] }, sign };
}

export const claimsFor = (projectId: string, uid: string, nowSec: number) => ({
  aud: projectId,
  iss: `https://securetoken.google.com/${projectId}`,
  sub: uid,
  user_id: uid,
  iat: nowSec - 60,
  auth_time: nowSec - 60,
  exp: nowSec + 3600,
});

export { b64url, fromB64url };
