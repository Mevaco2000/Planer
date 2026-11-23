# Planer

A task and project planner that runs as a PWA. You can install it on a phone or desktop, it works offline,
it syncs through Firebase, and a small Cloudflare Worker sends reminders as push notifications. It all fits
in the free tiers of Firebase and Cloudflare.

The UI is in Polish. [README.pl.md](README.pl.md) has a longer feature tour and a step-by-step setup guide.

## What it does

Tasks have a due date, time, duration, priority, subtasks, notes, a reminder and an optional repeat rule
(every N days/weeks/months, chosen weekdays, or N days after you last completed it). One task can count
toward several bigger tasks. Projects can be shown as a list, a kanban board, or an ordered plan where
each step waits for the previous one. There is a day planner with drag-and-drop time blocks, a
month/week/list calendar, and a graph view of how tasks connect.

The quick-add box parses Polish. `Raport w piątek o 10 przez 2h !1 #praca co tydzień` becomes a weekly
task on Friday at 10:00, two hours long, top priority, in the "praca" project. If you add something that
looks like an existing task (different case, missing diacritics, a typo), the app asks whether it's the
same one.

## Stack

- React 19, TypeScript, Vite, `vite-plugin-pwa` with a custom service worker
- Firebase Auth (Google, email) and Firestore with the persistent offline cache
- Cloudflare Worker + D1 for reminders. Cloud Functions need the paid Blaze plan, so a Worker cron runs
  every minute instead. Push payloads are encrypted (RFC 8291) and signed with VAPID (RFC 8292) using
  plain WebCrypto, and Firebase ID tokens are verified without the Admin SDK.

## Running it

You need Node 22+ and a Firebase project with Authentication (Google + Email/Password) and Firestore
enabled.

```
npm install
cp .env.example .env      # paste the web app config from the Firebase console
npm run dev               # http://localhost:5173
```

To deploy hosting and the Firestore rules:

```
npx firebase login
npx firebase use --add
npm run deploy
```

## Push reminders (optional)

The app works without this; you just don't get notifications. `worker/wrangler.toml` holds the values for
my deployment, so replace `database_id`, `FIREBASE_PROJECT_ID`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` and
`ALLOWED_ORIGINS` with your own.

```
npx wrangler login
npx wrangler d1 create planer     # copy database_id into worker/wrangler.toml
npm run worker:db                 # apply migrations
npm run vapid                     # prints a key pair: public key -> wrangler.toml, private key -> next line
npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml
npm run worker:deploy
```

Put the Worker URL in `.env` as `VITE_WORKER_URL`, run `npm run deploy` again, then enable notifications
in the app's settings on each device.

## Tests

```
npm test
npm run typecheck
```

The tests cover the quick-add parser, task logic and the full Worker flow (subscribe, sync reminders, cron,
encrypted push), with D1 swapped for `node:sqlite`. Encryption is checked against the test vector from
RFC 8291.

## Limitations

- Reminders are accurate to about a minute. Anything more than 6 hours late is skipped.
- `npm run dev` has no service worker, so test notifications with `npm run build && npm run preview`.
- Only tasks completed in the last 14 days are loaded live. Older ones stay in Firestore and are included
  in the JSON export.
