import { describe, expect, it } from 'vitest';
import { resetJwksCache, verifyFirebaseToken } from '../../worker/src/auth';
import { b64url, fromB64url, utf8 } from '../../worker/src/bytes';
import { encryptPayload, vapidHeader } from '../../worker/src/webpush';
import { browserSubscription, claimsFor, decryptPush, firebaseSigner, vapidKeys } from './helpers';

describe('Web Push – szyfrowanie (RFC 8291)', () => {
  it('zgadza się z przykładem z RFC 8291 (dodatek A)', async () => {
    const body = await encryptPayload(
      utf8('When I grow up, I want to be a watermelon'),
      { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      {
        salt: fromB64url('DGv6ra1nlYgDCS1FRnbzlw'),
        serverKeys: {
          privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
          publicKey: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
        },
      },
    );
    expect(b64url(body)).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    );
  });

  it('przeglądarka odszyfrowuje wiadomość (losowe klucze i sól)', async () => {
    const sub = await browserSubscription('https://push.test/x');
    const message = JSON.stringify({ title: 'Raport ✓', body: 'Dziś 18:00 · Praca' });
    const body = await encryptPayload(utf8(message), sub.json.keys);
    expect(await decryptPush(body, sub.ua)).toBe(message);
    // za każdym razem inna sól i klucz serwera
    expect(b64url(await encryptPayload(utf8(message), sub.json.keys))).not.toBe(b64url(body));
  });

  it('odrzuca złe klucze subskrypcji i za długą treść', async () => {
    await expect(encryptPayload(utf8('x'), { p256dh: 'AAAA', auth: 'BTBZMqHH6r4Tts7J_aSIgg' })).rejects.toThrow('klucze');
    const sub = await browserSubscription('https://push.test/x');
    await expect(encryptPayload(new Uint8Array(5000), sub.json.keys)).rejects.toThrow('długa');
  });
});

describe('VAPID (RFC 8292)', () => {
  it('JWT podpisany kluczem serwera, z adresem usługi push jako odbiorcą', async () => {
    const keys = await vapidKeys();
    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', { ...keys, subject: 'https://planer.example' }, 1_800_000_000);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(m[2])));
    expect(claims).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://planer.example' });
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, keys.verifyKey, fromB64url(m[3]), utf8(`${m[1]}.${m[2]}`));
    expect(ok).toBe(true);
  });
});

describe('token Firebase', () => {
  const projectId = 'planer-test';
  const now = 1_800_000_000_000;
  const sec = now / 1000;

  it('przyjmuje poprawny i odrzuca: obcy projekt, wygasły, podrobiony podpis, nieznany klucz', async () => {
    resetJwksCache();
    const g = await firebaseSigner();
    let fetches = 0;
    const fetchImpl = (async () => {
      fetches++;
      return new Response(JSON.stringify(g.jwks), { headers: { 'Cache-Control': 'public, max-age=20000' } });
    }) as typeof fetch;
    const opts = { now, fetchImpl, jwksUrl: 'https://jwks.test' };

    expect(await verifyFirebaseToken(await g.sign(claimsFor(projectId, 'u1', sec)), projectId, opts)).toBe('u1');
    await expect(verifyFirebaseToken(await g.sign(claimsFor('inny', 'u1', sec)), projectId, opts)).rejects.toThrow('innego projektu');
    await expect(verifyFirebaseToken(await g.sign({ ...claimsFor(projectId, 'u1', sec), exp: sec - 1 }), projectId, opts)).rejects.toThrow('wygasł');
    const other = await firebaseSigner();
    await expect(verifyFirebaseToken(await other.sign(claimsFor(projectId, 'u1', sec)), projectId, opts)).rejects.toThrow('podpis');
    await expect(verifyFirebaseToken(await g.sign(claimsFor(projectId, 'u1', sec), 'nieznany'), projectId, opts)).rejects.toThrow('Nieznany klucz');
    await expect(verifyFirebaseToken('abc', projectId, opts)).rejects.toThrow('Nieprawidłowy');
    // klucze są zapamiętywane – ponowne pobranie tylko dla nieznanego identyfikatora
    expect(fetches).toBe(2);
  });
});
