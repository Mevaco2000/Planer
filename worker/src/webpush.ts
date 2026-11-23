// Web Push bez bibliotek: szyfrowanie treści (RFC 8291, aes128gcm) i podpis VAPID (RFC 8292) na WebCrypto.
import { b64url, concat, fromB64url, uint32, utf8, type Bytes } from './bytes';

export interface PushTarget {
  endpoint: string;
  /** klucz publiczny przeglądarki (base64url, 65 bajtów) */
  p256dh: string;
  /** sekret uwierzytelniający (base64url, 16 bajtów) */
  auth: string;
}

export interface Vapid {
  /** klucz publiczny serwera (base64url, 65 bajtów, nieskompresowany punkt P-256) */
  publicKey: string;
  /** klucz prywatny serwera (base64url, 32 bajty – „d”) */
  privateKey: string;
  /** kontakt dla usług push: https://… albo mailto:… */
  subject: string;
}

const RECORD_SIZE = 4096;

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Klucz prywatny P-256 z „d” i punktu publicznego (x, y wycięte z 65-bajtowego klucza). */
function privateJwk(d: string, publicRaw: Bytes): JsonWebKey {
  return { kty: 'EC', crv: 'P-256', d, x: b64url(publicRaw.slice(1, 33)), y: b64url(publicRaw.slice(33, 65)), ext: true };
}

export interface EncryptOptions {
  /** do testów: stała sól i para kluczy serwera (normalnie losowe przy każdej wiadomości) */
  salt?: Bytes;
  serverKeys?: { privateKey: string; publicKey: string };
}

/** Zaszyfrowana treść wiadomości push (nagłówek aes128gcm + jeden rekord). */
export async function encryptPayload(plaintext: Bytes, target: Pick<PushTarget, 'p256dh' | 'auth'>, opts: EncryptOptions = {}): Promise<Bytes> {
  const uaPublic = fromB64url(target.p256dh);
  const authSecret = fromB64url(target.auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Nieprawidłowe klucze subskrypcji');
  if (plaintext.length + 17 > RECORD_SIZE) throw new Error('Za długa wiadomość');

  let asPrivate: CryptoKey;
  let asPublic: Bytes;
  if (opts.serverKeys) {
    asPublic = fromB64url(opts.serverKeys.publicKey);
    asPrivate = await crypto.subtle.importKey('jwk', privateJwk(opts.serverKeys.privateKey, asPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  }

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(utf8('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // ostatni (jedyny) rekord kończy się bajtem 0x02
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, new Uint8Array([2]))));
  return concat(salt, uint32(RECORD_SIZE), new Uint8Array([asPublic.length]), asPublic, cipher);
}

/** Nagłówek Authorization: vapid t=<JWT ES256>, k=<klucz publiczny>. */
export async function vapidHeader(endpoint: string, vapid: Vapid, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(utf8(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: vapid.subject })));
  const publicRaw = fromB64url(vapid.publicKey);
  const key = await crypto.subtle.importKey('jwk', privateJwk(vapid.privateKey, publicRaw), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  // WebCrypto zwraca podpis jako r‖s (64 bajty) – dokładnie tak, jak wymaga JWS
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64url(sig)}, k=${vapid.publicKey}`;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** subskrypcja wygasła (404/410) – do usunięcia */
  gone: boolean;
}

export interface PushMessage {
  title: string;
  body: string;
  tag: string;
  url: string;
}

export async function sendPush(target: PushTarget, message: PushMessage, vapid: Vapid, opts: { ttl?: number; fetchImpl?: typeof fetch } = {}): Promise<PushResult> {
  const body = await encryptPayload(utf8(JSON.stringify(message)), target);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await vapidHeader(target.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl ?? 6 * 3600),
        Urgency: 'high',
      },
      body,
    });
    return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410 };
  } catch {
    return { ok: false, status: 0, gone: false };
  }
}
