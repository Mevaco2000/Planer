// Generuje parę kluczy VAPID (P-256) dla przypomnień push.
// Klucz publiczny trafia do worker/wrangler.toml (VAPID_PUBLIC_KEY), prywatny – do sekretu Workera.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
const b64url = (b) => Buffer.from(b).toString('base64url');

console.log(`
Klucze VAPID (zachowaj klucz prywatny w tajemnicy – nie wpisuj go do plików w repozytorium):

1) worker/wrangler.toml → [vars]
   VAPID_PUBLIC_KEY = "${b64url(raw)}"

2) Sekret Workera – uruchom i wklej wartość, gdy zapyta:
   npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml
   wartość: ${jwk.d}
`);
