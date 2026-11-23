# Paczka obszaru offline — plan wykonania

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operator zaznacza prostokąt w CloudTAK, wybiera warstwy (z zakresem przybliżeń) i obiekty, a serwer składa paczkę danych ATAK (MBTiles + CoT) z linkiem publicznym i kodem QR oraz pliki PMTiles do pracy offline w przeglądarce.

**Architecture:** API (`api/`) trzyma tabelę `area_packages`, liczy podgląd (kafelki, rozmiar, dostępność warstw) i wydaje paczkę pod trasą publiczną z losowym tokenem. Nowa pula `AreaPackagePool` w `tasks/events` pobiera zadania tokenem `etl`, ściąga kafelki przez serwer kafelków v14 z limitem tempa na host, zapisuje MBTiles (`node:sqlite`), zamienia je na PMTiles (`pmtiles convert`, już w obrazie) i wgrywa PMTiles jako zwykłe zasoby profilu, więc istniejące `downloadOfflineTiles()` zapisuje je w OPFS bez zmian. Przeglądarka wysyła migawkę obiektów jako GeoJSON z bazy Atlas.

**Tech Stack:** TypeScript, Node 26 (`node:sqlite`), Drizzle, `@openaddresses/batch-schema`, `@tak-ps/node-cot` (`DataPackage`, `CoTParser`), Vue 3 + `@tak-ps/vue-tabler`, vitest, `tsx --test`, Helm (`~/taklab/charts`).

**Spec:** `docs/superpowers/specs/2026-11-23-area-offline-package-design.md`

## Global Constraints

- Identyfikatory i komentarze w kodzie po angielsku; teksty w UI przez `t()` z kluczami w `app/src/locales/pl/*.json` i `app/src/locales/en/*.json`.
- Google wykluczony zawsze, po stronie serwera: host adresu warstwy pasuje do `google.com`, `googleapis.com`, `gstatic.com` lub ich poddomen.
- Podkłady wektorowe (`type` ≠ raster) niedostępne w tej wersji.
- Pozycje ludzi (`COT.is_skittle`) nigdy nie trafiają do paczki.
- Limity (konfigurowalne, zmienne środowiskowe API): `AREA_PACKAGE_MAX_TILES=100000`, `AREA_PACKAGE_MAX_BYTES=2147483648`, `AREA_PACKAGE_MAX_FEATURES=5000`, treść żądania tworzącego ≤ 10 MB.
- Tempo pobierania (zmienne puli): host zewnętrzny 2 równoczesne i 10 kafelków/s; hosty wewnętrzne (`*.svc`, `*.svc.cluster.local`) i pliki profilu 16 równoczesnych bez limitu na sekundę. 429/503 → przerwa ×2, od 1 s do 60 s.
- Pula przetwarza jedno zadanie naraz (wtedy limit tempa na host jest globalny w środowisku).
- Link publiczny: `GET /api/public/area-package/:token.zip`, token = 32 losowe bajty base64url, każda porażka → 404 z tą samą treścią.
- QR: `tak://com.atakmap.app/import?url=<encodeURIComponent(origin + ścieżka)>&filename=<nazwa>.zip`.
- Szacunek rozmiaru: PNG 15 000 B, JPEG 25 000 B, WEBP 12 000 B na kafelek.
- Migracja Drizzle numer `0234`, `when` większy niż w `0233`.
- Lint: `oxlint --type-aware` w `api` i `tasks/*`, ESLint i `vue-tsc` w `app`.

## Review Focus

1. **Prostokąt przez antypołudnik albo poza zasięgiem Web Mercator (|lat| > 85.0511).** Oczekiwane: współrzędne przycięte do zasięgu, prostokąt przez 180° odrzucony z 400. Test w Zadaniu 1 (`tileRange` przycina, `validateBounds` odrzuca).
2. **Usunięcie paczki w trakcie składania.** Oczekiwane: pula przy następnym zgłoszeniu postępu dostaje 404, przerywa zadanie, sprząta pliki tymczasowe i nie wgrywa zasobów. Test w Zadaniu 6.
3. **Warstwa, której właściciel stracił dostęp (podkład usunięty lub ukryty) między podglądem a składaniem.** Oczekiwane: 401/403/404 z serwera kafelków przez cały pierwszy poziom = `Fail` z nazwą warstwy, nie pusta paczka. Test w Zadaniu 4.
4. **Nazwa paczki z `/`, `..`, cudzysłowem lub polskimi znakami.** Oczekiwane: nazwa pliku w zip, w `filename` QR i w `Content-Disposition` oczyszczona (`safeFileName`), polskie litery zachowane, `Content-Disposition` z `filename*=UTF-8''`. Test w Zadaniu 3.
5. **Restart poda `events` w trakcie zadania.** Oczekiwane: przy starcie pula woła `requeue`, zadania `Running` wracają do `Pending`, `progress=0`. Test w Zadaniu 3 (trasa) i 6 (wywołanie przy starcie).

---

### Task 1: Model danych i matematyka kafelków w API

**Files:**
- Modify: `api/common/schema.ts` (nowa tabela po `ProfileFile`)
- Create: `api/migrations/0234_area_packages.sql`, `api/migrations/meta/0234_snapshot.json`; Modify: `api/migrations/meta/_journal.json`
- Create: `api/common/models/AreaPackage.ts`; Modify: `api/common/models.ts`
- Create: `api/common/area-package.ts`
- Test: `api/test/area-package-tiles.test.ts`

**Interfaces:**
- Produces:
  - tabela `area_packages`: `id uuid pk default gen_random_uuid()`, `created`, `updated`, `username text → profile.username`, `name text`, `token text unique`, `status text` (`Pending|Running|Success|Fail`, default `Pending`), `error text null`, `progress integer default 0`, `bounds geometry(Polygon,4326)`, `layers jsonb` (`AreaPackageLayer[]`), `features jsonb` (GeoJSON Feature[]), `assets uuid[] default '{}'`, `size bigint default 0`; indeks `(username, created)`.
  - `type AreaPackageLayer = { source: 'basemap', id: number, name: string, format: 'png'|'jpeg'|'webp', host: string, minzoom: number, maxzoom: number } | { source: 'profile', file: string, name: string, format: ..., host: 'profile', minzoom, maxzoom }`
  - `type BBox = [west: number, south: number, east: number, north: number]`
  - `validateBounds(b: BBox): void` — rzuca `Err(400)` gdy `west >= east`, `south >= north`, wartości poza ±180/±90.
  - `tileRange(b: BBox, z: number): { minX, maxX, minY, maxY }` (XYZ, przycięte do ±85.0511°).
  - `countTiles(b: BBox, minzoom: number, maxzoom: number): number`
  - `isGoogleUrl(url: string): boolean`
  - `estimateBytes(tiles: number, format: string): number`
  - `safeFileName(name: string): string` — usuwa `/ \ : * ? " < > |` i znaki sterujące, zastępuje `..`, przycina do 100 znaków, puste → `paczka`.
  - `newToken(): string` (32 bajty `crypto.randomBytes`, base64url).
  - `config.models.AreaPackage` (Modeler, wzorem `ProfileFile`).

- [ ] **Step 1: Write the failing test** `api/test/area-package-tiles.test.ts`:
  - `tileRange([0,0,1,1], 0)` → `{minX:0,maxX:0,minY:0,maxY:0}`.
  - `tileRange([20.9,52.1,21.1,52.3], 10)` = `{minX:571,maxX:572,minY:336,maxY:337}`, więc `countTiles(…, 10, 10)` = 4 (wzór XYZ: `x=floor((lon+180)/360·2^z)`, `y=floor((1−ln(tan φ+sec φ)/π)/2·2^z)`; wartości policzone ręcznie — jeśli test z poprawną implementacją da inne, sprawdź je w tools.geofabrik.de/calc i popraw asercję, nie kod).
  - `countTiles(b, 10, 12)` = suma trzech poziomów.
  - `tileRange([-10,-89,10,89], 2).maxY` = 3 (przycięcie).
  - `validateBounds([170,0,-170,10])` rzuca 400; `validateBounds([0,0,0,1])` rzuca 400.
  - `isGoogleUrl('https://mt1.google.com/vt/lyrs=y&x={x}')` true; `'https://tile.googleapis.com/v1/2dtiles'` true; `'https://tile.openstreetmap.de/{z}/{x}/{y}.png'` false; `'https://notgoogle.com.evil.pl/'` false.
  - `estimateBytes(10,'png')` = 150000; `'jpeg'` = 250000; `'webp'` = 120000.
  - `safeFileName('../Wyjście "A"/23')` = `'Wyjście A23'`-podobne bez `/`, `..`, `"`; zawiera `ś`.
  - `newToken()` ma 43 znaki `[A-Za-z0-9_-]`, dwa wywołania różne.
- [ ] **Step 2: Run** `cd api && StackName=test npx tsx --test test/area-package-tiles.test.ts` → FAIL (brak modułu).
- [ ] **Step 3: Implement** `api/common/area-package.ts` (funkcje wyżej), tabelę w `schema.ts`, model `AreaPackage.ts` i rejestrację w `models.ts`. Migrację wygeneruj `npx drizzle-kit generate --name area_packages` i sprawdź numer `0234` oraz rosnące `when` w `_journal.json`.
- [ ] **Step 4: Run** test z kroku 2 → PASS; `cd api && npx drizzle-kit check` bez błędów; `npm run lint` czysto.
- [ ] **Step 5: Commit** `git commit -m "Paczka obszaru: tabela area_packages i matematyka kafelków"`

### Task 2: Trasy właściciela: podgląd, tworzenie, lista, usunięcie

**Files:**
- Create: `api/stateless/routes/area-package.ts`
- Test: `api/test/area-package.srv.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces (wszystkie `security: Auth.security()` — użytkownik):
  - `POST /api/profile/area-package/preview` body `{ bounds: BBox, layers: Array<{source:'basemap',id:number,minzoom?:number,maxzoom?:number} | {source:'profile',file:string,minzoom?,maxzoom?}> }` → `{ layers: Array<{ source, id?|file?, name, available: boolean, reason?: 'google'|'vector'|'forbidden', minzoom, maxzoom, layer_minzoom, layer_maxzoom, tiles, bytes }>, tiles, bytes, limits: { tiles, bytes, features } }`. Brak `minzoom/maxzoom` w żądaniu → zakres warstwy. Podkład: `config.models.Basemap.from(id)` + sprawdzenie dostępu użytkownika jak w `routes/basemap.ts` GET; plik profilu: `ProfileFile` należący do użytkownika z artefaktem `.pmtiles`, zakres z nagłówka PMTiles nie jest potrzebny — użyj `0–22`, a serwer kafelków zwróci 404 poza danymi.
  - `POST /api/profile/area-package` body `{ name: string (1–100), bounds: BBox, layers: [...jak wyżej z wymaganymi minzoom/maxzoom], features: GeoJSON.Feature[] }` → `AreaPackageResponse` (bez pól `features`; z `token`). Odrzuca 400: warstwa niedostępna, zakres poza `layer_minzoom–layer_maxzoom`, `minzoom > maxzoom`, suma kafelków > limit, szacunek > limit bajtów, `features.length` > limit. Zapisuje `layers` z `name`, `format`, `host` (host z `basemap.url`, dla pliku `'profile'`), `token: newToken()`, `bounds` jako wielokąt.
  - `GET /api/profile/area-package` → `{ total, items: AreaPackageResponse[] }` (tylko własne, od najnowszych).
  - `GET /api/profile/area-package/:id` → `AreaPackageResponse`; cudza → 404.
  - `DELETE /api/profile/area-package/:id` → `{status:200}`; usuwa `area-package/<id>/` z S3, zasoby profilu z `assets` (ta sama logika co `DELETE /profile/asset/:asset`, wydziel do funkcji w `common/control/` jeśli jest inline) i wiersz.
  - `AreaPackageResponse = { id, name, status, error, progress, bounds, layers, assets, size, token, created, updated }`.
- Limit 10 MB treści: sprawdź, jak `batch-schema` ustawia limit `express.json` w `api/index.ts`; jeśli globalny jest niższy, podnieś go tylko dla tej trasy.

- [ ] **Step 1: Write the failing tests** w `api/test/area-package.srv.test.ts` (wzorem `import.srv.test.ts`, z `flight`):
  - preview z podkładem OSM i podkładem Google → OSM `available:true, tiles>0, bytes=tiles*15000`, Google `available:false, reason:'google'`.
  - preview z podkładem wektorowym → `reason:'vector'`.
  - POST z Google → 400; z `maxzoom` > `layer_maxzoom` → 400; z 5001 obiektami → 400; ze zbyt dużym obszarem (np. cała Polska, z 0–18) → 400 z komunikatem o limicie kafelków.
  - POST poprawny → 200, `status:'Pending'`, `token` 43 znaki, w odpowiedzi brak `features`.
  - GET lista innego użytkownika nie zawiera paczki; GET `/:id` innego użytkownika → 404.
  - DELETE → 200, potem GET → 404.
- [ ] **Step 2: Run** `cd api && StackName=test npx tsx --test test/area-package.srv.test.ts` (baza jak przy testach API v14, obraz `cloudtak-dev:26`) → FAIL.
- [ ] **Step 3: Implement** `api/stateless/routes/area-package.ts`; zarejestruj trasę tak, jak ładowane są inne pliki z `routes/` (sprawdź w `api/index.ts`).
- [ ] **Step 4: Run** test → PASS; `npm run lint`.
- [ ] **Step 5: Commit** `"Paczka obszaru: podgląd i trasy właściciela"`

### Task 3: Trasa publiczna i trasy wewnętrzne dla puli

**Files:**
- Modify: `api/stateless/routes/area-package.ts`
- Test: `api/test/area-package-public.srv.test.ts`

**Interfaces:**
- Consumes: Task 1–2.
- Produces:
  - `GET /api/public/area-package/:token.zip` — `security: Auth.security({ optional: true })` (jak `GET /config` w `routes/config.ts`). Tylko `status='Success'`; strumień `S3.get('area-package/<id>/package.zip')`, `Content-Type: application/zip`, `Content-Length` z `S3.head`, `Content-Disposition: attachment; filename="<ascii>.zip"; filename*=UTF-8''<encoded safeFileName(name)>.zip`. Każdy inny przypadek → `404 {status:404,message:'Not Found'}`.
  - Trasy dla tokenu `etl` z `access: 'area-package'` (dopisz `'area-package'` do listy zasobów w `api/common/auth.ts` i w `tasks/pmtiles/lib/auth.ts` nie trzeba):
    - `GET /api/area-package?status=Pending&limit=N` → `{ items: AreaPackageJob[] }` gdzie `AreaPackageJob = AreaPackageResponse & { username, features }`.
    - `PATCH /api/area-package/:id` body `{ status?, progress?, error?, size?, assets? }` → `AreaPackageJob`; nieistniejąca → 404.
    - `POST /api/area-package/requeue` → `{ count }`; `Running` → `Pending`, `progress=0`.

- [ ] **Step 1: Write the failing tests**:
  - token nieznany → 404; paczka `Pending` → 404; paczka `Success` z plikiem w S3 (mock S3 jak w istniejących testach) → 200, nagłówek `content-disposition` zawiera `filename*=UTF-8''` i zakodowane `ś`; po DELETE → 404; wszystkie trzy 404 mają identyczną treść.
  - żądanie bez nagłówka `Authorization` działa (200 dla `Success`).
  - `etl` z `access:'import'` na `GET /api/area-package` → 401/403; z `access:'area-package'` → lista z `features` i `username`.
  - `requeue` zamienia `Running` na `Pending` i zeruje `progress`.
  - zwykły token użytkownika na `PATCH /api/area-package/:id` → 401/403.
- [ ] **Step 2: Run** `cd api && StackName=test npx tsx --test test/area-package-public.srv.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; cały `npm test` w `api` nie ma nowych porażek (znane trzy z upstream: basemap-args ×2, connection-layer-task-capabilities).
- [ ] **Step 5: Commit** `"Paczka obszaru: link publiczny i trasy dla puli"`

### Task 4: Pobieranie kafelków z limitem tempa (pula)

**Files:**
- Create: `tasks/events/src/area-package/tiles.ts` (kopia `tileRange`/`countTiles` z Task 1 — `tasks/events` nie importuje z `api/`; obie kopie mają ten sam test wartości)
- Create: `tasks/events/src/area-package/limiter.ts`
- Create: `tasks/events/src/area-package/fetch-tiles.ts`
- Test: `tasks/events/test/area-package-fetch.test.ts`

**Interfaces:**
- Produces:
  - `class HostLimiter { constructor(opts: { concurrency: number, perSecond: number | null }); run<T>(fn: () => Promise<T>): Promise<T>; backoff(): void }` — `backoff()` podwaja przerwę (1 s → 60 s max), sukces ją zeruje.
  - `limiterFor(host: string): HostLimiter` — cache per host; `host` kończący się na `.svc`, `.svc.cluster.local` lub `'profile'` → `{16, null}`, pozostałe `{2, 10}`.
  - `tileUrl(tilesBase: string, layer: AreaPackageLayer, username: string, z, x, y): string` — podkład: `${tilesBase}/tiles/basemap/${id}/tiles/${z}/${x}/${y}`; plik: `${tilesBase}/tiles/profile/${encodeURIComponent(username)}/${encodeURIComponent(file)}/tiles/${z}/${x}/${y}.${format}`. Token w `?token=`: podkład `jwt.sign({access:'user', email: username}, secret)`, plik `jwt.sign({access:'profile', email: username}, secret)`.
  - `async function* fetchLayerTiles(opts: { tilesBase, secret, username, layer, bounds: BBox, signal: AbortSignal }): AsyncGenerator<{ z, x, y, data: Buffer }>` — pomija 404 i puste ciała; 429/503 → `backoff()` i ponowienie bez limitu prób; inne błędy → do 3 prób, potem rzuca `Error('<nazwa warstwy>: <kod>')`. Jeśli żaden kafelek pierwszego (najniższego) poziomu nie przyszedł, a wszystkie odpowiedzi to 401/403/404 → rzuca `Error('<nazwa warstwy>: brak dostępu albo brak danych')`.

- [ ] **Step 1: Write the failing tests** (lokalny `http.createServer` jako atrapa serwera kafelków):
  - 2×2 kafelki na poziomie → generator oddaje 4 elementy z poprawnymi `z/x/y`.
  - atrapa zwraca 404 dla jednego → 3 elementy, brak błędu.
  - atrapa zwraca 429 raz, potem 200 → kafelek dociera; czas ≥ 1 s.
  - atrapa zwraca 500 zawsze dla jednego → rzuca z nazwą warstwy po 3 próbach.
  - atrapa zwraca 403 dla wszystkiego → rzuca „brak dostępu albo brak danych”.
  - `HostLimiter({concurrency:2, perSecond:10})` przy 30 zadaniach: nigdy > 2 równocześnie, całość ≥ 2,5 s.
  - `limiterFor('taklab-tiles.taklab-system.svc')` ma concurrency 16.
  - wartości `countTiles` identyczne z testem z Task 1 (te same liczby).
- [ ] **Step 2: Run** `cd tasks/events && npx tsx --test test/area-package-fetch.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm run lint`.
- [ ] **Step 5: Commit** `"Paczka obszaru: pobieranie kafelków z limitem tempa"`

### Task 5: MBTiles, PMTiles i paczka danych

**Files:**
- Create: `tasks/events/src/area-package/mbtiles.ts`, `tasks/events/src/area-package/build.ts`
- Test: `tasks/events/test/area-package-build.test.ts`

**Interfaces:**
- Consumes: Task 4 (`fetchLayerTiles`).
- Produces:
  - `class MBTilesWriter { constructor(path: string, meta: { name, format, bounds: BBox, minzoom, maxzoom }); put(z, x, y, data: Buffer): void; close(): void }` — `node:sqlite` `DatabaseSync`; tabele `metadata(name, value)` i `tiles(zoom_level, tile_column, tile_row, tile_data)` z unikalnym indeksem; `tile_row = 2^z - 1 - y` (TMS); metadane `name`, `format`, `bounds` (`"w,s,e,n"`), `minzoom`, `maxzoom`, `type=baselayer`, `version=1.1`; wstawianie w transakcjach po 500.
  - `async function toPMTiles(mbtiles: string, out: string): Promise<void>` — `pmtiles convert`, jak w `src/transform.ts:321`.
  - `async function buildDataPackage(opts: { id, name, mbtiles: Array<{ path, fileName }>, features: GeoJSON.Feature[], attachments: (hash: string) => Promise<{ name, body: Buffer } | null> }): Promise<string>` — `new DataPackage(id, name)`, `setPermanent()`, każdy MBTiles `addFile(stream, { name: fileName })`, każdy obiekt `CoTParser.from_geojson` → `addCoT`, załączniki z `properties.attachments` przez `attachments(hash)` (null = pomiń), `finalize()` → ścieżka zip. Obiekt, którego `from_geojson` nie przyjmie → pomiń i policz (zwróć liczbę w logu).

- [ ] **Step 1: Write the failing tests**:
  - `MBTilesWriter` dla kafelka `z=1,x=0,y=0` zapisuje `tile_row=1`; `metadata.bounds` = `"20.9,52.1,21.1,52.3"`; `type=baselayer`.
  - `buildDataPackage` z jednym MBTiles i dwoma obiektami (punkt, linia) → `DataPackage.parse(zip)`: `files()` zawiera plik `.mbtiles`, `cots()` ma 2 elementy, `manifest()` zawiera nazwę paczki i `uid` = `id`.
  - obiekt z nieistniejącym załącznikiem → paczka powstaje.
  - obiekt z geometrią `null` → pominięty, paczka powstaje.
  - `toPMTiles` — test pomijany (`skip`), gdy `which pmtiles` zawodzi; w obrazie Dockera uruchamiany: wynik zaczyna się od bajtów `PMTiles`.
- [ ] **Step 2: Run** `cd tasks/events && npx tsx --test test/area-package-build.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Paczka obszaru: zapis MBTiles, PMTiles i paczki danych"`

### Task 6: Pula zadań i przebieg całego zadania

**Files:**
- Create: `tasks/events/src/area-package/pool.ts`, `tasks/events/src/area-package/job.ts`
- Modify: `tasks/events/index.ts` (start drugiej puli w bloku `isMainModule`, zmienna `TILES_URL`, domyślnie `http://localhost:5002`)
- Test: `tasks/events/test/area-package-job.test.ts`

**Interfaces:**
- Consumes: Task 3 (trasy `etl`), 4, 5; `POST /api/profile/asset` (istniejąca, token `jwt.sign({access:'user', email: username}, secret)` jak w `src/transform.ts`).
- Produces:
  - `class AreaPackagePool { constructor(opts: { api, tiles, secret, bucket, interval }); start(): Promise<void>; close(): Promise<void> }` — `start()` woła raz `POST /api/area-package/requeue`, potem co `interval` ms, gdy nic nie biegnie: pobiera 1 `Pending`, `PATCH status=Running`, uruchamia `runJob`. Zadanie biegnie w tym samym procesie (praca to sieć i SQLite), nie w `Worker`.
  - `async function runJob(job: AreaPackageJob, ctx: { api, tiles, secret, bucket, tmpdir }): Promise<void>`:
    1. Dla każdej warstwy `MBTilesWriter` + `fetchLayerTiles`; co 2 s `PATCH progress` (odsetek pobranych z łącznej `countTiles`). Odpowiedź 404 na `PATCH` → `AbortController.abort()`, sprzątanie `tmpdir`, koniec bez dalszych wywołań.
    2. Po każdej warstwie: `toPMTiles`; nowe `uuid` zasobu; upload `profile/<username>/<uuid>.pmtiles`; `POST /api/profile/asset` `{ id: uuid, name: '<safeFileName(name)> – <layer.name>.pmtiles', artifacts: [{ ext: '.pmtiles' }] }`.
    3. `buildDataPackage` (pliki MBTiles nazwane `<safeFileName(layer.name)>.mbtiles`), upload `area-package/<id>/package.zip`.
    4. `PATCH { status:'Success', progress:100, size: <bajty zip>, assets: [uuid…] }`.
    5. Wyjątek → `PATCH { status:'Fail', error: message }`, sprzątanie `tmpdir`; zasoby profilu wgrane przed błędem zostają w `assets` (wysłane w tym samym PATCH), żeby DELETE je usunął.
    6. Rozmiar zip > `AREA_PACKAGE_MAX_BYTES` → `Fail` „Paczka przekracza limit rozmiaru”.

- [ ] **Step 1: Write the failing tests** (atrapa API i serwera kafelków na `http.createServer`, S3 — atrapa jak w `test/worker-*.test.ts`):
  - przebieg sukcesu: atrapa API dostaje kolejno `PATCH Running`… `PATCH progress`… `POST /api/profile/asset` (1 na warstwę), `PATCH Success` z `assets.length === 1`; do S3 trafiają `profile/<user>/<uuid>.pmtiles` (gdy `pmtiles` dostępny; inaczej atrapa `toPMTiles`) i `area-package/<id>/package.zip`.
  - atrapa API zwraca 404 na `PATCH progress` → brak `POST /api/profile/asset`, brak uploadu zip, `tmpdir` usunięty.
  - serwer kafelków 403 na wszystko → `PATCH Fail` z nazwą warstwy.
  - `start()` woła `requeue` przed pierwszym `GET`.
- [ ] **Step 2: Run** `cd tasks/events && npx tsx --test test/area-package-job.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npm test` w `tasks/events` bez nowych porażek; `npm run lint`.
- [ ] **Step 5: Commit** `"Paczka obszaru: pula zadań w tasks/events"`

### Task 7: Przeglądarka — zaznaczenie prostokąta i obiekty z obszaru

**Files:**
- Modify: `app/src/stores/modules/draw.ts`
- Modify: `app/src/workers/atlas-database.ts`
- Test: `app/src/test/draw-capture.spec.ts`, `app/src/test/atlas-area-features.spec.ts`

**Interfaces:**
- Produces:
  - `draw.start(mode, opts: { icon?: string, capture?: (geometry: GeoJSON.Polygon) => void })` — z `capture` przy `DrawToolMode.RECTANGLE` zakończenie rysowania woła `capture(geometry)`, czyści rysunek i `stop()`; nie woła `db.add`, nie robi `router.push`.
  - `AtlasDatabase.areaFeatures(bbox: [number, number, number, number]): Promise<Array<{ id: string, kind: 'marker'|'shape'|'route', title: string, feature: Feature }>>` — obiekty z `this.cots` i z subskrybowanych misji (pętla jak przy `filter`, linia ~702), których geometria przecina prostokąt (`@turf/boolean-intersects` — dodaj zależność, albo `booleanWithin`/`bbox` jeśli wystarczy), bez `is_skittle`, bez obiektów ukrytych (to samo kryterium, którym mapa decyduje o rysowaniu — znajdź je w `stores/map.ts`/`atlas-database.ts` i użyj, nie kopiuj). `kind`: `Point` → marker; `LineString` z typem trasy (`b-m-r`, jak `isPublishedRoute`) → route; reszta → shape. `feature` = `cot.as_feature()` (lub odpowiednik pełnego GeoJSON z właściwościami CoT).

- [ ] **Step 1: Write the failing tests**:
  - `capture`: po zakończeniu prostokąta callback dostaje `Polygon`, `db.add` nie jest wywołane.
  - `areaFeatures`: z bazą zawierającą marker w środku, marker poza, kontakt (`is_skittle`) w środku, trasę przecinającą brzeg, obiekt misji w środku → zwraca marker, trasę (`kind:'route'`) i obiekt misji; bez kontaktu i markera spoza.
  - obiekt ukryty filtrem nie wraca.
- [ ] **Step 2: Run** `cd app && npx vitest run src/test/draw-capture.spec.ts src/test/atlas-area-features.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `npx vue-tsc --noEmit`; `npm run lint`.
- [ ] **Step 5: Commit** `"Paczka obszaru: zaznaczanie prostokąta i obiekty z obszaru"`

### Task 8: Suwak z dwoma uchwytami

**Files:**
- Create: `app/src/components/CloudTAK/util/ZoomRangeSlider.vue`
- Test: `app/src/components/CloudTAK/util/ZoomRangeSlider.spec.ts`

**Interfaces:**
- Produces: `<ZoomRangeSlider v-model='[min, max]' :min='number' :max='number' :disabled='boolean' />`, emituje `update:modelValue` z `[number, number]`, krok 1, `min ≤ dolny ≤ górny ≤ max`. Dwa `input type=range` nałożone na siebie (dostępne z klawiatury, `aria-label` z `t('map.areaPackage.zoomMin')`/`zoomMax`), etykieta `10–16`.

- [ ] **Step 1: Write the failing tests**: przesunięcie dolnego powyżej górnego → emitowane `[g, g]`; wartości poza `min/max` przycinane; strzałka w prawo na górnym uchwycie zwiększa o 1; `disabled` blokuje oba.
- [ ] **Step 2: Run** `cd app && npx vitest run src/components/CloudTAK/util/ZoomRangeSlider.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Paczka obszaru: suwak zakresu przybliżeń"`

### Task 9: Okno wyboru zawartości paczki

**Files:**
- Create: `app/src/components/CloudTAK/util/AreaPackageModal.vue`
- Modify: `app/src/locales/pl/map.json`, `app/src/locales/en/map.json` (klucze `map.areaPackage.*`)
- Test: `app/src/components/CloudTAK/util/AreaPackageModal.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`preview`, `POST`), 7 (`areaFeatures`), 8.
- Produces: `<AreaPackageModal :bounds='BBox' @close @created='(pkg: AreaPackageResponse) => void' />`.
  - Warstwy: aktualny podkład i włączone nakładki rastrowe z `mapStore.overlays` (tryb `basemap` → `{source:'basemap', id}`, tryb `profile` z plikiem PMTiles → `{source:'profile', file}`; pozostałe pomiń). Na otwarciu i po każdej zmianie suwaka (z opóźnieniem 300 ms) `POST /api/profile/area-package/preview`.
  - Warstwa `available:false` → bez pola wyboru, tekst `t('map.areaPackage.unavailable.<reason>')` (pl: google „Niedostępne offline (zasady Google)”, vector „Mapa wektorowa — ATAK jej nie wyświetli”, forbidden „Brak dostępu”).
  - Grupy z przełącznikiem „wszystkie”: Podkłady, Markery (n), Kształty (n), Trasy (n), domyślnie wszystko zaznaczone, suwak domyślnie zakres z podglądu ograniczony do `[max(layer_minzoom, zoom mapy − 2), min(layer_maxzoom, zoom mapy + 4)]`.
  - Nazwa domyślna `Paczka <dd.mm HH:MM>`.
  - Stopka: „Razem: ~<rozmiar>”, przekroczony limit → komunikat i wyłączony „Zapisz”.
  - „Zapisz” → `POST /api/profile/area-package` z `features` wybranych obiektów → `emit('created', pkg)`.
  - Teksty pl według szkicu ze specyfikacji („Zapisz do cache: obszar 12,4 × 8,1 km”).

- [ ] **Step 1: Write the failing tests** (std zamockowany jak w istniejących spec):
  - otwarcie z dwiema warstwami (OSM, Google) → wywołanie `preview`, Google bez pola wyboru z tekstem o Google.
  - odznaczenie grupy „Markery” → `POST` bez markerów, z trasami.
  - zmiana suwaka → po 300 ms drugie `preview` z nowym zakresem.
  - `preview.tiles > limits.tiles` → „Zapisz” wyłączony.
  - brak obiektów i jedna warstwa → `POST` z `features: []` działa.
- [ ] **Step 2: Run** `cd app && npx vitest run src/components/CloudTAK/util/AreaPackageModal.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; `vue-tsc`, lint.
- [ ] **Step 5: Commit** `"Paczka obszaru: okno wyboru zawartości"`

### Task 10: Lista paczek, kod QR i zapis offline

**Files:**
- Create: `app/src/components/CloudTAK/Menu/MenuAreaPackages.vue`
- Modify: `app/src/router.ts` (trasa `area-packages` obok `files`), wpis w menu głównym obok „Pliki” (ten sam plik, który rejestruje wpis `files` — znajdź przez `grep -rn "menu/files" app/src/components`)
- Modify: `app/src/locales/{pl,en}/menu.json`
- Test: `app/src/components/CloudTAK/Menu/MenuAreaPackages.spec.ts`

**Interfaces:**
- Consumes: Task 2, 3, 7, 9; `downloadOfflineTiles(asset: ProfileFile)` z `stores/modules/offline-tiles.ts`; akcja „dodaj na mapę” zasobu profilu — ta sama, której używa `MenuFilesRow.vue`; generator QR — ta sama biblioteka/trasa co `Menu/Mission/DataSyncQrModal.vue`.
- Produces:
  - Przycisk „Nowa paczka (zaznacz obszar)” → `draw.start(DrawToolMode.RECTANGLE, { capture })` → `AreaPackageModal` z `bbox(geometry)`.
  - Wiersz paczki: nazwa, data, stan (`Pending`/`Running` z `progress`%, `Fail` z `error`), rozmiar; dla `Success`: kod QR z `tak://com.atakmap.app/import?url=${encodeURIComponent(location.origin + '/api/public/area-package/' + token + '.zip')}&filename=${encodeURIComponent(safeName + '.zip')}`, przycisk „Kopiuj link” (adres https), „Zapisz offline w tej przeglądarce” (dla każdego `assets[i]`: `GET /api/profile/asset/<id>` → `downloadOfflineTiles` → dodanie warstwy na mapę), „Usuń” z potwierdzeniem w `TablerModal` (nie `window.confirm`) → `DELETE` i `removeOfflineTiles` dla `assets`.
  - Odświeżanie listy co 3 s, gdy jakaś paczka jest `Pending`/`Running`.
  - Paczka utworzona w tej sesji (z `@created`) po przejściu w `Success` sama uruchamia „Zapisz offline w tej przeglądarce”.

- [ ] **Step 1: Write the failing tests**:
  - `Success` → QR zawiera dokładnie `tak://com.atakmap.app/import?url=https%3A%2F%2F…%2Fapi%2Fpublic%2Farea-package%2F<token>.zip&filename=…`.
  - „Usuń” → potwierdzenie → `DELETE` i `removeOfflineTiles` dla każdego zasobu.
  - paczka z `@created` przechodzi `Running` → `Success` przy odpytaniu → `downloadOfflineTiles` wywołane raz na zasób; paczka sprzed sesji — nie.
  - `Fail` pokazuje `error`.
- [ ] **Step 2: Run** `cd app && npx vitest run src/components/CloudTAK/Menu/MenuAreaPackages.spec.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS; cały `npx vitest run` w `app` zielony; `vue-tsc`, lint.
- [ ] **Step 5: Commit** `"Paczka obszaru: lista paczek, kod QR i zapis offline"`

### Task 11: Charty taklab

**Files (w `~/taklab`, gałąź `cloudtak-area-package` w worktree):**
- Modify: `charts/ots-env/templates/cloudtak-events.yaml`, `charts/takserver-env/templates/cloudtak-events.yaml`
- Modify: `charts/ots-env/templates/networkpolicy*.yaml` i odpowiednik w `takserver-env` (tylko jeśli ruch `events → tiles:5002` jest dziś blokowany)
- Modify: `charts/*/values.yaml` (`resources.events`, limit `emptyDir`)
- Test: `tests/test_szablony.py`, `tests/test_szablony_takserver.py`

**Interfaces:**
- Produces: w kontenerze `events` zmienne `TILES_URL=http://<env>-cloudtak-tiles:5002`, `AREA_PACKAGE_MAX_TILES`, `AREA_PACKAGE_MAX_BYTES` (z `values.yaml`, `cloudtak.areaPackage.maxTiles: 100000`, `maxBytes: 2147483648`); te same limity w kontenerze API CloudTAK (`cloudtak.yaml`) plus `AREA_PACKAGE_MAX_FEATURES: 5000`. Wolumen `emptyDir` `sizeLimit: 6Gi` zamontowany jako katalog tymczasowy puli (`TMPDIR`). Pamięć `events` ≥ 1Gi limitu; dodatek do ResourceQuota w Gi.

- [ ] **Step 1: Write the failing tests**: render obu chartów zawiera `TILES_URL` z nazwą środowiska, `emptyDir.sizeLimit: 6Gi` i limity w API i events; jeśli dopisujesz regułę polityki — test na port 5002 od `events`.
- [ ] **Step 2: Run** `cd ~/taklab-wt-area-package && .venv/bin/pytest tests/test_szablony.py tests/test_szablony_takserver.py -q` → FAIL.
- [ ] **Step 3: Implement**; sprawdź na `public` przed zmianą polityki: `kubectl -n tak-public exec deploy/public-cloudtak-events -- wget -qO- -T5 http://public-cloudtak-tiles:5002/tiles` (z `KUBECONFIG=~/taklab/deploy/aws/kubeconfig`).
- [ ] **Step 4: Run** → PASS; cały `pytest` taklab zielony.
- [ ] **Step 5: Commit** `"CloudTAK: paczki obszarów — zmienne, wolumen i limity puli events"`

### Task 12: Sprawdzenie od końca do końca (bez produkcji)

**Files:** brak zmian kodu; notatka wyników w `docs/superpowers/plans/2026-11-24-area-offline-package.md` (sekcja „Wynik”).

- [ ] **Step 1:** Postaw stos lokalnie (`docker compose` forka z `api`, `tiles`, `events`, MinIO, PostGIS), zaloguj się, dodaj podkład OSM.de i mapę sztabową (albo dowolny ZXY), zaznacz obszar ~3 × 3 km, zakres 12–15, dwa markery i trasę. Oczekiwane: paczka `Success` w < 2 min, w MinIO `area-package/<id>/package.zip` i zasób `.pmtiles` na liście plików.
- [ ] **Step 2:** W przeglądarce: paczka zapisała się offline sama; DevTools → Network → Offline; przewijanie i przybliżanie w obszarze pokazuje kafelki, poza obszarem puste.
- [ ] **Step 3:** Emulator ATAK (patrz pamięć `reference_atak_emulator_cot`): `adb shell am start -a android.intent.action.VIEW -d 'tak://com.atakmap.app/import?url=<adres zip przez adb reverse>&filename=test.zip'`. Oczekiwane: pytanie „Import …”, po „Tak” mapa w Mapach (Mobile) i obiekty na mapie; wyłączenie sieci emulatora — mapa nadal się rysuje. Jeśli ATAK nie zainstaluje MBTiles z paczki: sprawdź w korpusie `~/Pulpit/atak-lab` (skill `atak-plugin`), jak `MissionPackage` przekazuje pliki do importerów, i dodaj w `buildDataPackage` właściwy parametr `contentType` przy `addFile`; dopisz test w Task 5.
- [ ] **Step 4:** Trasa publiczna: `curl -sI https://localhost/api/public/area-package/<token>.zip` → 200; zły token → 404; po „Usuń” → 404.
- [ ] **Step 5:** Wynik zapisz w sekcji „Wynik” tego planu i commit `"Paczka obszaru: wynik sprawdzenia od końca do końca"`.

Wdrożenie (podbicie `images/cloudtak/COMMIT`, `.cloudtak-version`, `.api-version`, budowa obrazów, Jenkins `taklab-produkcja`, `taklab upgrade public`) idzie po zatwierdzeniu wyników przez użytkownika, zwykłą drogą ze skilla `taklab-deploy`. Nie należy do tego planu.
