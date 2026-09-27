# Budynki 3D z Cesium ion w CloudTAK

Data: 2026-09-27
Repozytorium: `~/CloudTAK-fork` (MapLibre GL 5.24)
Środowisko docelowe: public-mapa.taklab.eu

## Cel

Użytkownik CloudTAK włącza w menu Overlays warstwę budynków 3D i widzi bryły na pochylonej
mapie razem z markerami CoT (Cursor on Target, format pozycji TAK). Dostępne są dwie warstwy:

- **OSM Buildings**: szare bryły z OpenStreetMap, Cesium ion asset 96188.
- **Google Photorealistic**: fotorealistyczny mesh Google, Cesium ion asset 2275207.

Główny token Cesium ion nie opuszcza serwera. Dostęp do kafli dostaje tylko zalogowany
użytkownik CloudTAK.

## Stan wyjściowy

- „Tryb 3D” w CloudTAK to rzut kuli ziemskiej (`display_projection: globe`) i rzeźba terenu
  (`map.setTerrain()` w `api/web/src/stores/map.ts`). Rzeźba terenu przyjmuje tylko źródło
  `raster-dem` w kodowaniu `terrarium` albo `mapbox`.
- MapLibre nie czyta formatu 3D Tiles ani quantized-mesh. W kodzie nie ma odwołań do Cesium.
- Nakładki użytkownika leżą w tabeli `profile_overlays` (pole `type`: vector, raster, geojson).
  Rysuje je `api/web/src/base/overlay.ts`.
- Konfigurację administratora obsługuje `api/routes/config.ts`. Klucze spoza
  `UserConfigKeys` i `PublicConfigKeys` czyta tylko administrator.

## Wybrane rozwiązanie

deck.gl `MapboxOverlay` w trybie przeplatanym (interleaved) z warstwą `Tile3DLayer`
z `@loaders.gl/3d-tiles`. Warstwa deck.gl rysuje się wewnątrz MapLibre i dzieli z mapą bufor
głębi, więc budynki zasłaniają markery CoT stojące za nimi.

Odrzucone podejścia:

- **three.js + `3d-tiles-renderer`**: kamerę three.js trzeba ręcznie zgrać z macierzą
  MapLibre, a tryb kuli ziemskiej wymaga osobnych przeliczeń. Zostaje jako zapas, jeśli próba
  wykonalności wypadnie źle.
- **Osobny widok CesiumJS**: markery, rysowanie i czat CloudTAK nie byłyby na nim widoczne.
  Paczka ma około 3 MB.

## Krok 0: próba wykonalności

Próba idzie na gałęzi `spike/3dtiles`. Jej kod nie wchodzi do forka.

1. Sprawdź, czy `MapboxOverlay` w trybie przeplatanym rysuje OSM Buildings pod MapLibre 5.24.
2. Sprawdź, czy marker CoT za budynkiem jest zasłonięty, a przed budynkiem widoczny.
3. Sprawdź, czy kafle Google z endpointu ion się wczytują, łącznie z parametrem `session`
   w zapytaniach o kafle potomne.
4. Sprawdź zachowanie przy rzucie kuli ziemskiej i przy włączonej rzeźbie terenu.

Wynik zapisz w `docs/superpowers/specs/2026-09-27-ion-3dtiles-spike.md` ze zrzutami ekranu.
Notatka kończy się jedną z trzech decyzji:

- deck.gl zostaje, bez zmian w projekcie;
- deck.gl zostaje, ale włączenie nakładki 3D przełącza mapę na rzut Mercatora i wyłącza teren;
- przejście na three.js + `3d-tiles-renderer`, co wymaga poprawienia tej specyfikacji.

## Serwer

### Konfiguracja

- Nowy klucz `ion::token` (string) w `FullConfig`. Klucz nie trafia do `UserConfigKeys`
  ani `PublicConfigKeys`, więc czyta go i zmienia tylko administrator.
- Admin → Config → Map dostaje pole „Cesium ion token” typu hasło.
- Jeśli `ion::token` jest pusty, serwer bierze token ze zmiennej środowiskowej
  `CESIUM_ION_TOKEN`. Tak wdrażamy token na klastrze (sekcja „Wdrożenie”).

### Lista dozwolonych zasobów

Lista jest zaszyta w kodzie serwera:

| Nazwa | Asset ion | Etykieta |
|---|---|---|
| `osm-buildings` | 96188 | OSM Buildings |
| `google-photorealistic` | 2275207 | Google Photorealistic |

Użytkownik nie podaje numeru zasobu. Token nie służy więc do pobierania innych zasobów
z konta ion.

### Trasy

**`GET /api/ion`**

- Wymaga zalogowania (`Auth.as_user`).
- Zwraca `{ items: [{ name, label }] }` z listy dozwolonych zasobów.
- Bez skonfigurowanego tokenu zwraca `{ items: [] }`.

**`GET /api/ion/{name}/endpoint`**

- Wymaga zalogowania (`Auth.as_user`).
- Nazwa spoza listy dozwolonych: 404.
- Brak tokenu: 404 z komunikatem „Cesium ion is not configured”.
- Woła `GET https://api.cesium.com/v1/assets/{id}/endpoint` z nagłówkiem
  `Authorization: Bearer {ion::token}`.
- Zwraca ujednoliconą odpowiedź `{ url, accessToken?, attributions[] }`:
  - OSM Buildings: `url` to adres `tileset.json`, `accessToken` to krótkotrwały token ion;
  - Google: `url` to adres `root.json` z kluczem Google podanym przez ion, bez `accessToken`.
- ion odpowiada 401 albo 403: trasa zwraca 502 z komunikatem „Cesium ion rejected the token”.
- Brak łączności z ion albo inny błąd ion: trasa zwraca 502.

### Pamięć podręczna

- Serwer trzyma w pamięci odpowiedź endpointu osobno dla każdego zasobu.
- Wpis traci ważność 5 minut przed wygaśnięciem `accessToken`. Jeśli czas wygaśnięcia jest
  nieznany, wpis traci ważność po 50 minutach.
- Błędne odpowiedzi nie trafiają do pamięci podręcznej.
- Wpis pamięta token, którym go pobrano. Po zmianie tokenu wpis jest nieważny i serwer
  pyta ion od nowa.

## Klient

### Dodawanie nakładki

- Overlay Explorer (`MenuOverlayExplorer.vue`) dostaje sekcję „3D Buildings” z pozycjami
  z `GET /api/ion`. Przy pustej liście sekcja się nie pokazuje.
- Kliknięcie pozycji zakłada wpis w `profile_overlays`:
  `type: '3dtiles'`, `mode: 'ion'`, `mode_id: '{name}'`, `url: 'ion:{name}'`.
- Ograniczenie unikalności `(username, url)` uniemożliwia dodanie tej samej warstwy dwa razy.
- Serwer akceptuje `type: '3dtiles'` w trasach `profile-overlays`.
- Włączanie, wyłączanie, przezroczystość i usuwanie działają w menu Overlays tak samo jak
  przy innych nakładkach.

### Moduł `api/web/src/base/tiles3d.ts`

- Moduł jest wczytywany dynamicznym `import()` dopiero przy pierwszej aktywnej nakładce 3D.
  Użytkownik bez nakładek 3D nie pobiera deck.gl ani loaders.gl.
- Na mapie jest jedna wspólna instancja `MapboxOverlay` w trybie przeplatanym.
- Każda nakładka 3D to jedna `Tile3DLayer` w tej instancji.
- Funkcje: `add(overlay)`, `remove(overlay)`, `setVisible(overlay, visible)`,
  `setOpacity(overlay, opacity)`.
- Warstwy 3D dostają `beforeId` pierwszej warstwy CoT. Markery i rysunki leżą nad budynkami
  w kolejności rysowania. Warstwy `circle` i `symbol` MapLibre nie używają bufora głębi, więc
  marker za budynkiem pozostaje widoczny (zmierzone w próbie).
- Moduł podaje loaders.gl własną funkcję `fetch`. Dokleja ona nagłówek ion i w JSON-ie tilesetu
  zamienia `region` szerszy niż π/2 na kulę obejmującą Ziemię. Bez tego loaders.gl nie wybiera
  żadnego kafla OSM Buildings (zmierzone w próbie).
- Tileset jest przesunięty w dół o 34 m (wysokość geoidy nad Polską) przez
  `loadOptions.tileset.modelMatrix`. Dopóki jakakolwiek nakładka 3D jest widoczna, teren MapLibre
  jest włączony z przewyższeniem 1. Tylko wtedy budynki stoją na swoich obrysach.
- Przy starcie mapy nakładki użytkownika powstają przed warstwą CoT. Moduł ustala `beforeId`
  w chwili rysowania i sprawdza, czy taka warstwa istnieje. Po założeniu warstwy CoT
  `stores/map.ts` każe modułowi przerysować warstwy 3D.

### Zmiany w `overlay.ts`

- Dla `type === '3dtiles'` klasa `Overlay` pomija źródła i warstwy MapLibre.
- Zamiast nich woła odpowiednie funkcje `tiles3d`.

### Odnawianie dostępu

- Przed zbudowaniem warstwy klient pobiera `/api/ion/{name}/endpoint`.
- Jeśli odpowiedź zawiera `accessToken`, klient wysyła go w nagłówku zapytań o kafle.
- Po 50 minutach klient pobiera endpoint ponownie i podmienia warstwę.
- Po pierwszej odpowiedzi 401 z serwera kafli klient robi to samo od razu.

### Atrybucje

- Gdy nakładka 3D jest widoczna, stopka mapy pokazuje atrybucje z odpowiedzi endpointu.
- Dla Google stopka pokazuje dodatkowo logo Google, zgodnie z warunkami Google Map Tiles API.
- ion podaje atrybucje jako HTML. Serwer nie przekazuje tego HTML dalej: zamienia każdą
  atrybucję na `{ text, image? }`, gdzie `image` to adres obrazka tylko z domeny `cesium.com`
  po HTTPS. Klient składa stopkę z tekstu uciekniętego przed wstawieniem i z obrazka.

## Testy

### Serwer: `api/test/ion.srv.test.ts`

Wywołania ion zastępuje atrapa `fetch`. Przypadki:

1. `GET /api/ion` bez logowania zwraca 401 (tak odpowiada `Auth.as_user` w CloudTAK, „No Auth Present”).
2. `GET /api/ion` bez tokenu zwraca pustą listę.
3. `GET /api/ion/{name}/endpoint` dla nazwy spoza listy zwraca 404.
4. Endpoint bez tokenu zwraca 404.
5. Dwa zapytania o ten sam zasób dają jedno wywołanie ion.
6. Zapytanie po wygaśnięciu wpisu daje drugie wywołanie ion.
7. Odpowiedź 401 z ion zamienia się w 502 i nie trafia do pamięci podręcznej.
8. Nie-administrator nie odczyta `ion::token` przez `GET /api/config`.
9. Zmiana tokenu daje nowe wywołanie ion.
10. Pusty `ion::token` i ustawiona zmienna `CESIUM_ION_TOKEN`: serwer używa zmiennej.

### Klient: vitest dla `tiles3d.ts`

deck.gl jest zamockowany. Przypadki: dodawanie, usuwanie, widoczność, przezroczystość,
odnowienie dostępu po 401 i po 50 minutach.

### Kontrole całościowe

- `npm run lint` i `npm test` w `api`.
- `npm run lint`, `npm run check` i `npm test` w `api/web`.
- Sprawdzenie w przeglądarce na public-mapa.taklab.eu: obie nakładki nad Warszawą,
  pochylony widok, marker CoT za budynkiem jest zasłonięty.

## Wdrożenie

- Token ion leży w sekrecie Kubernetesa `{env}-secrets` pod kluczem `cesium-ion-token`.
- Chart `taklab/charts/ots-env` podaje go kontenerowi CloudTAK jako zmienną
  `CESIUM_ION_TOKEN` (`secretKeyRef` z `optional: true`, więc środowisko bez tokenu wstaje).
  Token przetrwa odtworzenie środowiska.
- `job-cloudtak-konfiguracja` nie nadaje się do tego: działa tylko przy pierwszej konfiguracji
  CloudTAK i kończy się od razu na już skonfigurowanym środowisku.
- Nowy tag obrazu `taklab/cloudtak-api`, wdrożenie przez Jenkinsa.

## Poza zakresem

- Mesh GUGiK z własnego serwera.
- Pełny pośrednik kafli przez API CloudTAK.
- Limity ruchu na użytkownika.
- Pomiar wysokości i odległości na bryłach.
