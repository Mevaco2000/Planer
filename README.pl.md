# Planer – zadania i projekty

Aplikacja webowa (PWA) do planowania zadań i projektów – do zainstalowania na telefonie i komputerze.
Działa offline, synchronizuje się między urządzeniami i przypomina o terminach powiadomieniami push.
Całość mieści się w darmowych planach Firebase (Spark) i Cloudflare (Workers Free).

## Co potrafi

- **Dziś** – zaległe i dzisiejsze zadania, pasek postępu dnia, „Przełóż zaległe na dziś”, lista zrobionych dziś.
- **Plan dnia** – oś godzin z blokami zadań (dowolny dzień, strzałkami albo z kalendarza). Przeciągnij zadanie
  z listy „Do zaplanowania” (zadania tego dnia bez godziny, zaległe, bez terminu) na godzinę; blok – na inną godzinę;
  dolną krawędź bloku – żeby zmienić czas trwania (co 15 min). Kliknięcie w wolne miejsce dodaje zadanie o tej godzinie.
  Nachodzące zadania stają obok siebie, czerwona linia pokazuje „teraz”, a na kolejne dni widać przerywane
  powtórzenia rutyn. **Przesuń palcem w bok**, żeby przejść na poprzedni/następny dzień (na komputerze: poziomy gest
  na touchpadzie albo strzałki ← →).
- **Kalendarz** – trzy widoki:
  - **Miesiąc** – duża siatka z zadaniami w każdym dniu (na telefonie kolorowe paski), pod spodem lista wybranego
    dnia; przeciągnij zadanie na inny dzień, dwuklik w dzień – plan dnia;
  - **Tydzień** – oś godzin dla 7 dni i wiersz zadań bez godziny; przeciągnij blok na inny dzień i godzinę,
    kliknij wolne miejsce – nowe zadanie o tej godzinie;
  - **Lista** – najbliższe 2 tygodnie dzień po dniu (dawne „Nadchodzące”), dalej „Później”.

  Przesunięcie w bok zmienia miesiąc albo tydzień. Opcjonalnie widać przyszłe powtórzenia rutyn.
- **Skrzynka** – otwarte zadania bez projektu. Zadanie odhaczone gdziekolwiek (Dziś, Plan, Kalendarz) od razu stąd znika.
- **Rutyny** (w Projektach) – wszystkie powtarzane zadania: co ile, kiedy następny raz, kiedy ostatnio i ile razy.
  „Pomiń ten raz” przesuwa termin bez liczenia jako zrobione.
- **Projekty** – kolor, licznik otwartych/zaległych, postęp, **grupy projektów** (zwijane; projekt należy do jednej grupy).
  W projekcie **Lista**, **Tablica** (Do zrobienia / W trakcie / Zrobione) albo **Plan** – kroki w ustalonej kolejności
  (przeciąganie albo strzałki), „Następny krok”, ostrzeżenie, gdy termin kroku wypada przed poprzednim.
  Projekt **„po kolei”** blokuje kroki do czasu zrobienia poprzedniego – w innych widokach mają znaczek „czeka”,
  a odhaczenie kroku poza kolejnością wymaga potwierdzenia.
- **Etapy** – poziom między projektem a zadaniem (np. „Przygotowanie”, „Wykonanie”, „Odbiór”): nazwa, termin,
  kolejność, postęp. Lista projektu jest pogrupowana po etapach (zadanie przeciągnięte na inny etap zmienia etap),
  a wybrany etap filtruje wszystkie widoki projektu. W szybkim dodawaniu: „#remont/wykonanie”.
- **Zadanie wpływa na kilka większych** – np. „Kupić klej” potrzebny i do „Położyć płytki”, i do „Wylewki”:
  odhaczasz raz, postęp widać w obu. Powiązanie ustawisz w edycji zadania („Wpływa na”) albo wpisując w podzadaniach
  nazwę istniejącego zadania („Powiąż: …”).
- **Pytanie „czy to to samo?”** – gdy dodajesz zadanie, krok albo podzadanie podobne do istniejącego (także inaczej
  zapisane: wielkość liter, polskie znaki, literówka), aplikacja pyta przed dodaniem. W „Dziś”, Skrzynce, projekcie
  i grafie pyta też o pary, które już są. „To samo” łączy je w jedno zadanie powiązane z oboma większymi (z cofnięciem),
  „Różne” – zapamiętuje parę i więcej o nią nie pyta.
- **Graf zadań** (Projekty → „Graf” albo widok „Graf” w projekcie) – projekty, etapy, zadania i podzadania jako węzły;
  przerywana linia = zadanie wpływa też na inne większe zadanie. Przybliżanie (także Ctrl + kółko), zrobione
  na życzenie, kliknięcie węzła otwiera zadanie, etap albo projekt.
- **Szybkie dodawanie po polsku** (przycisk „+” albo klawisz **N**): wpisz
  „Raport w piątek o 10 przez 2h !1 #praca co tydzień”, a aplikacja sama ustawi termin, godzinę, czas trwania,
  priorytet, projekt i powtarzanie.
  Rozumie m.in. *dziś, jutro, pojutrze, w poniedziałek, w przyszły piątek, do piątku, 15.12, 3 grudnia, za 3 dni,
  za tydzień, za miesiąc, o 18, 9:30, rano, wieczorem, przez 2h, 1,5 h, 45 min, !1–!4, pilne, #projekt, codziennie,
  co 2 dni, co drugi dzień, co 2 tygodnie, co 3 miesiące, w dni robocze, w poniedziałki i czwartki, co pon, śr, pt,
  w weekendy, co piątek, co miesiąc, co rok*. Rozpoznane fragmenty widać na podglądzie – krzyżykiem można je odrzucić
  (np. gdy „Jutro” to tytuł książki). Enter dodaje i czyści pole, więc można wpisywać zadanie za zadaniem.
- **Zadanie**: termin, godzina i **czas trwania**, priorytet (pilne / wysoki / średni), status, projekt, **podzadania**,
  notatka, **powtarzanie** (codziennie, w dni robocze, co tydzień, co miesiąc, co rok; **co N dni/tygodni/miesięcy/lat**,
  **wybrane dni tygodnia**, liczone **od terminu** – stały rytm – albo **od zrobienia**, np. fryzjer 2 tygodnie po
  ostatniej wizycie; odhaczenie przesuwa termin i zeruje podzadania) i **przypomnienie** (w momencie terminu,
  10/30/60 min albo dzień wcześniej; zadania bez godziny – rano o wybranej godzinie).
- Każde odhaczenie, przełożenie i usunięcie można **cofnąć** z komunikatu.
- **Przypomnienia push** na telefonie i komputerze (Android, Windows, macOS; iPhone – po dodaniu do ekranu
  głównego, iOS 16.4+). Kliknięcie w powiadomienie otwiera zadanie.
- **Szukaj** (ikona lupy u góry albo klawisz **/**) w nazwach, notatkach, podzadaniach i projektach.
- Na telefonie okna (dodawanie, edycja) mieszczą się nad klawiaturą, a dolny pasek chowa się na czas pisania.
- **Ustawienia**: przypomnienia, domyślne przypomnienie, godzina porannych przypomnień, kopia danych (JSON),
  sprzątanie starych zrobionych zadań, instalacja aplikacji.
- Tryb ciemny, offline (pamięć podręczna Firestore), komunikat o nowej wersji.

## Koszt: 0 zł

| Usługa | Do czego | Darmowy plan |
| --- | --- | --- |
| Firebase Authentication | logowanie (Google, e-mail) | bez opłat |
| Cloud Firestore | zadania, projekty, ustawienia | Spark: ok. 50 tys. odczytów i 20 tys. zapisów dziennie |
| Firebase Hosting | strona aplikacji | Spark: 10 GB miejsca |
| Cloudflare Workers + Cron | wysyłka przypomnień co minutę | Free: 100 tys. zapytań dziennie |
| Cloudflare D1 | kopia najbliższych przypomnień i subskrypcje urządzeń | Free: 5 GB, 100 tys. zapisów dziennie |

Jedna osoba zużywa ułamek tych limitów. Cloud Functions w Firebase wymagają płatnego planu Blaze, dlatego
przypomnienia wysyła Worker Cloudflare.

## Uruchomienie krok po kroku

### 1. Node.js

Zainstaluj Node.js 22 lub nowszy, a potem w folderze projektu:

```
npm install
```

### 2. Projekt Firebase (jednorazowo, ok. 5 minut)

Użyj **osobnego projektu** – `npm run deploy` nadpisuje reguły Firestore.

1. [console.firebase.google.com](https://console.firebase.google.com) → **Dodaj projekt** (np. `planer`), Analytics niepotrzebne.
2. **Build → Authentication → Get started**, włącz **Google** i **Email/Password**.
3. **Build → Firestore Database → Create database** (lokalizacja np. `eur3`, tryb produkcyjny).
4. **Ustawienia projektu → Twoje aplikacje → `</>` (Web)**, nazwa dowolna. Skopiuj `.env.example` do `.env`
   i wpisz wartości z „Konfiguracji SDK”.
5. `npx firebase login`, potem `npx firebase use --add` i wybierz projekt (alias `default`).

```
npm run dev        # http://localhost:5173
```

### 3. Wdrożenie

```
npm run deploy     # build + Firebase Hosting + reguły Firestore
```

Aplikacja będzie pod `https://TWOJ-PROJEKT.web.app`. Na telefonie otwórz adres i wybierz
„Zainstaluj aplikację” / „Dodaj do ekranu głównego”.

## Przypomnienia push (Cloudflare, opcjonalnie)

Bez tego kroku aplikacja działa normalnie – przypomnienie widać wtedy tylko przy zadaniu.

1. Załóż darmowe konto na [dash.cloudflare.com](https://dash.cloudflare.com) i zaloguj Wranglera:
   ```
   npx wrangler login
   ```
2. Baza D1:
   ```
   npx wrangler d1 create planer
   ```
   Skopiuj `database_id` z wyniku do `worker/wrangler.toml`, a potem utwórz tabele:
   ```
   npm run worker:db
   ```
3. Klucze VAPID (podpisują powiadomienia):
   ```
   npm run vapid
   ```
   Klucz publiczny wpisz w `worker/wrangler.toml` (`VAPID_PUBLIC_KEY`), a prywatny zapisz jako sekret:
   ```
   npx wrangler secret put VAPID_PRIVATE_KEY --config worker/wrangler.toml
   ```
4. W `worker/wrangler.toml` uzupełnij `FIREBASE_PROJECT_ID`, `VAPID_SUBJECT` (adres aplikacji)
   i `ALLOWED_ORIGINS` (adresy `web.app` i `firebaseapp.com` Twojego projektu).
5. Wdrożenie Workera:
   ```
   npm run worker:deploy
   ```
   Adres z wyniku (np. `https://planer-push.TWOJA-NAZWA.workers.dev`) wpisz w `.env` jako `VITE_WORKER_URL`
   i wdróż aplikację ponownie (`npm run deploy`).
6. W aplikacji: **Ustawienia → Przypomnienia → Włącz powiadomienia**, potem **Wyślij próbne**.
   Powiadomienia włącza się osobno na każdym urządzeniu.

Jak to działa: po każdej zmianie zadań aplikacja wysyła do Workera listę przypomnień na najbliższe 60 dni
(tylko gdy coś się zmieniło). Worker trzyma ją w D1 i co minutę sprawdza, czy nadszedł czas któregoś z nich.
Treść powiadomienia jest szyfrowana (Web Push, RFC 8291) i podpisana kluczem VAPID (RFC 8292) – bez zewnętrznych
bibliotek, na WebCrypto. Worker sprawdza token logowania Firebase, więc każdy widzi tylko swoje przypomnienia.
Wygasłe subskrypcje (np. po odinstalowaniu przeglądarki) są usuwane same.

## Architektura

- **Front**: React 19 + TypeScript + Vite, `vite-plugin-pwa` (własny service worker: offline + push).
- **Dane**: Cloud Firestore z trwałą pamięcią podręczną (IndexedDB) – odczyty i zapisy działają offline.
- **Bezpieczeństwo**: [firestore.rules](firestore.rules) – każdy widzi tylko swoje dane; podstawowa walidacja pól.
- **Przypomnienia**: [worker/](worker/) – Cloudflare Worker (HTTP + cron co minutę) i baza D1.

```
users/{uid}                  ustawienia (godzina porannych przypomnień, domyślne przypomnienie, pary „to różne”)
users/{uid}/groups/{id}      grupy projektów
users/{uid}/projects/{id}    projekty (grupa, „po kolei”)
users/{uid}/stages/{id}      etapy projektów (projekt, nazwa, kolejność, termin)
users/{uid}/tasks/{id}       zadania (termin, godzina, czas trwania, priorytet, status, podzadania, powtarzanie
                             z regułą „co N” / dni tygodnia / od zrobienia, przypomnienie, kolejność kroku,
                             etap, parentIds – większe zadania, na które zadanie wpływa)

D1: subscriptions            urządzenia z włączonymi powiadomieniami
D1: reminders                najbliższe przypomnienia (kopia – źródłem prawdy są zadania w Firestore)
```

Kod: `src/lib/quickAdd.ts` (parser szybkiego dodawania), `src/lib/repeat.ts` (rutyny i powtarzanie),
`src/lib/tasks.ts` (kolejność, przypomnienia, układ planu dnia, kroki projektu), `src/lib/db.ts` (zapisy),
`src/data.tsx` (subskrypcje na żywo), `src/lib/push.ts` (powiadomienia), `src/lib/viewport.ts` (klawiatura ekranowa),
`src/pages/Plan.tsx` (plan dnia), `src/components/ProjectPlan.tsx` (kroki projektu),
`src/lib/links.ts` (powiązania zadań, podobne nazwy, łączenie duplikatów), `src/lib/graph.ts` (układ grafu),
`src/lib/calendar.ts` + `src/pages/Calendar.tsx` (kalendarz), `src/components/Duplicates.tsx` (pytania „czy to to samo?”),
`src/components/useDrag.tsx` (przeciąganie), `src/components/useSwipe.ts` (przesuwanie w bok), `src/sw.ts` (service worker),
`worker/src/webpush.ts` (szyfrowanie i VAPID), `worker/src/auth.ts` (token Firebase), `worker/src/index.ts`.

## Testy

```
npm test           # parser, logika zadań, Worker (szyfrowanie wg wektora z RFC 8291, VAPID, tokeny,
                   # pełny przepływ subskrypcja → przypomnienia → cron → push na SQLite zamiast D1)
npm run typecheck  # aplikacja, service worker i Worker
```

## Ograniczenia

- Przypomnienia przychodzą z dokładnością do ok. minuty (cron co minutę). Spóźnione o ponad 6 godzin
  (np. gdy Worker nie działał) są pomijane.
- W trybie `npm run dev` nie ma service workera – powiadomienia sprawdzisz po `npm run build && npm run preview`
  albo po wdrożeniu.
- Na żywo widać zrobione zadania z ostatnich 14 dni; starsze są w bazie (kopia JSON w Ustawieniach).
