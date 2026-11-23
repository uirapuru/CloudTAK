# Paczka obszaru: mapa offline w CloudTAK i paczka dla ATAK przez kod QR

Data: 2026-11-23. Repozytorium: fork CloudTAK (`taklab/v14.0.0`), gałąź `taklab/area-package`. Wdrożenie przez charty `~/taklab`.

## Po co

Operator ma otwarty CloudTAK i liczy się z tym, że internet na jakiś czas zniknie. Mapa ma wtedy dalej działać w zaznaczonym obszarze. Drugi przypadek: internet jeszcze jest, ludzie szykują się do wyjścia, a operator daje im paczkę do pobrania. Paczka zawiera kafelki map z zaznaczonego obszaru i obiekty z mapy: markery, kształty, trasy. Ludzie skanują kod QR telefonem z ATAK i mają to wszystko u siebie bez połączenia z serwerem. ATAK ma taką funkcję u siebie. CloudTAK jej nie ma.

## Przepływ dla operatora

1. Operator zaznacza prostokąt na mapie i wciska „Zapisz do cache”.
2. Otwiera się okno z listą tego, co leży w obszarze. Każda pozycja ma pole wyboru, a każda grupa ma przełącznik „wszystkie”:
   - **Podkłady**: aktualny podkład i nakładki rastrowe włączone na mapie;
   - **Markery**;
   - **Kształty** (linie, wielokąty, okręgi);
   - **Trasy**.
3. Każdy wybrany podkład ma suwak przybliżenia z dwoma uchwytami, dolnym i górnym, jak w ATAK. Zakres suwaka to `minzoom`–`maxzoom` podkładu. Obok pokazuje się na żywo liczba kafelków i szacowany rozmiar.
4. Operator wpisuje nazwę paczki (domyślnie data i godzina) i zatwierdza.
5. Serwer składa paczkę w tle. Na liście „Paczki obszarów” widać postęp, a po zakończeniu kod QR, link i przyciski „Zapisz offline w tej przeglądarce” i „Usuń”.
6. Telefon z ATAK skanuje kod. ATAK pyta „Importować <adres>?”, pobiera plik i importuje go: mapa trafia do warstw, obiekty na mapę.

Szkic okna:

```
┌ Zapisz do cache: obszar 12,4 × 8,1 km ─────────────┐
│ Nazwa: [Wyjście 23 XI 18:40          ]             │
│                                                    │
│ ☑ Podkłady                            [wszystkie]  │
│   ☑ OpenStreetMap     zoom ●━━━━━━━━● 10–16        │
│                       2 340 kafelków, ~38 MB       │
│   ☐ Ortofoto GUGiK    zoom ●━━━━━━● 12–17          │
│   ─ Google Satellite  niedostępne offline          │
│ ☑ Markery (14)                        [wszystkie]  │
│   ☑ PO-1  ☑ PO-2  ☐ Punkt zborny ...               │
│ ☑ Kształty (3)                        [wszystkie]  │
│ ☑ Trasy (2)                           [wszystkie]  │
│                                                    │
│ Razem: ~52 MB                [Anuluj] [Zapisz]     │
└────────────────────────────────────────────────────┘
```

## Cele

- Kafelki wybranych podkładów z obszaru w zakresie przybliżeń, zapisane w przeglądarce do pracy bez internetu.
- Ta sama zawartość jako paczka danych ATAK (plik zip z `MANIFEST/manifest.xml`): kafelki jako MBTiles, obiekty jako CoT.
- Kod QR z linkiem `tak://com.atakmap.app/import?url=<adres paczki>&filename=<nazwa>.zip`. Sprawdzone w korpusie ATAK: obsługuje go `ImportExportMapComponent` w 5.7 i 5.8.
- Lista paczek z usuwaniem.

## Poza zakresem

- Aktualizacja paczki po zmianie obiektów. Paczka to migawka z chwili utworzenia; nowa wersja = nowa paczka.
- Pozycje ludzi (urządzeń i kontaktów). Pomijamy je zawsze, także gdy leżą w obszarze.
- Obszar inny niż prostokąt.
- Dane wysokości (DTED) i mapy 3D.
- Synchronizacja obiektów edytowanych offline z powrotem na serwer. Tym zajmuje się istniejąca kolejka `FeatureOutbox`.

## Czego nie wolno zepsuć (anty-cele)

- Kafelki Google nie trafiają do paczki ani do pamięci offline. Zabraniają tego zasady Google. Podkład z Google widać na liście jako niedostępny, bez pola wyboru.
- Paczka nie wycieka poza swój link. Bez linku nie da się jej znaleźć: nie ma listy publicznej, a identyfikator jest losowy.
- Składanie paczki nie może zablokować serwera kafelków dla pozostałych użytkowników. Nie może też ściągnąć na serwer taklab blokady od dostawcy mapy za zbyt szybkie pobieranie. Dotyczy to zwłaszcza darmowych serwerów (OpenStreetMap.de, OpenTopoMap, CyclOSM, Waymarked Trails), których regulaminy zabraniają masowego pobierania.

## Decyzje użytkownika

- Zaznaczenie obszaru → „Zapisz do cache” → okno z polami wyboru wszystkiego, co jest w obszarze, pogrupowane na podkłady, markery, kształty, trasy.
- Przybliżenie wybiera się suwakiem z dwoma uchwytami (dolny i górny limit).
- **Link do paczki działa bez logowania i jest ważny do skasowania paczki.** Każdy, kto ma link albo zdjęcie kodu QR, może pobrać paczkę. To świadome ryzyko: paczka zawiera położenia markerów. Nie dodajemy wygasania, hasła ani limitu pobrań bez nowej decyzji.
- Budowa: paczkę składa serwer (droga A).
- **Do paczki można wysłać każdy obiekt, który operator widzi na mapie w obszarze**, także cudze i z misji. Wyjątkiem są pozycje ludzi.
- **Do paczki można wysłać każdą mapę, którą operator ma na mapie**, w tym darmowe serwery OSM i OpenTopoMap. Wyjątek: Google (zasady Google, decyzja wcześniejsza i zapisana w skillu `taklab-environments`). Ryzyko blokady przez dostawcę ogranicza tempo pobierania (patrz „Proces roboczy”), nie lista dozwolonych map.

## Podejścia

| | Opis | Za | Przeciw |
|---|---|---|---|
| **A, wybrane** | Serwer pobiera kafelki, składa MBTiles, PMTiles i paczkę, odkłada w MinIO | karta nie musi być otwarta; duże obszary; jeden limit tempa; te same kafelki w ATAK i przeglądarce | więcej kodu po stronie serwera; paczki zajmują miejsce do skasowania |
| B | Przeglądarka pobiera kafelki, składa MBTiles i zip, wysyła na serwer po link | mało kodu na serwerze | karta otwarta przez całe pobieranie; setki MB w przeglądarce i drugi raz w górę |
| C | Paczka w paczkach danych serwera TAK (Marti) | gotowy mechanizm | pobranie wymaga certyfikatu klienta, a link ma działać bez logowania |

Użytkownik wybrał A.

## Projekt

### Model danych (API, nowa tabela `area_packages`)

Pola: `id` (uuid), `username`, `name`, `token` (losowe 32 bajty w base64url, unikalne), `status` (`Pending` / `Running` / `Success` / `Fail`), `error`, `progress` (0–100), `bounds` (wielokąt 4326), `request` (JSON: warstwy z zakresami przybliżeń), `features` (JSON: migawka obiektów jako GeoJSON), `size` (bajty), `created`, `updated`. Migracja Drizzle w kolejnym numerze po `0233`.

### Trasy API

- `POST /api/profile/area-package` — tworzy wpis `Pending`. Przyjmuje nazwę, prostokąt, listę warstw `{source, minzoom, maxzoom}` (źródło to `basemap` z `id` albo `profile` z nazwą pliku) i obiekty jako GeoJSON. Obiekty wysyła przeglądarka z lokalnej bazy Atlas, bo tylko ona ma komplet tego, co operator widzi: własne obiekty, misje i strumień z serwera TAK. Serwer nie sprawdza pochodzenia obiektów. Operator może wysłać, co widzi. Limit: 5000 obiektów i 10 MB treści żądania. Serwer odrzuca podkład Google, podkład wektorowy (patrz niżej) i zakres przybliżeń spoza `minzoom`–`maxzoom` podkładu.
- `GET /api/profile/area-package`, `GET /api/profile/area-package/:id`, `DELETE /api/profile/area-package/:id` — lista, stan, usunięcie (wpis i pliki w MinIO). Tylko właściciel.
- `GET /api/profile/area-package/:id.pmtiles` — plik PMTiles dla pamięci offline przeglądarki, tylko właściciel.
- `GET /api/public/area-package/:token.zip` — **bez uwierzytelnienia**. Strumień paczki z MinIO z `Content-Disposition: attachment`. Nieznany token, paczka nie w stanie `Success` albo skasowana → 404, ta sama odpowiedź dla każdego przypadku. W `security` jawnie `Auth.security({ optional: true })` albo odpowiednik dla trasy publicznej (v14 sprawdza `security` przed obsługą).
- Trasy wewnętrzne dla procesu roboczego (token `etl`, wzorem `/api/import`): pobranie zadań `Pending`, zgłoszenie postępu, wyniku i błędu.

### Proces roboczy

Nowy rodzaj zadania w istniejącym procesie `tasks/events`. Ma już wdrożenie w chartach taklab, dostęp do MinIO, token `etl` i pętlę odpytywania API. Kroki:

1. Dla każdego podkładu policz kafelki prostokąta w zakresie przybliżeń. Przekroczony limit → `Fail` z czytelnym komunikatem.
2. Pobierz kafelki przez serwer kafelków v14 (`/tiles/basemap/:id/:z/:x/:y`), z ograniczoną liczbą równoczesnych żądań. Tempo na jeden host dostawcy: najwyżej 2 równoczesne żądania i 10 kafelków na sekundę, łącznie dla wszystkich zadań w środowisku. Dla własnego serwera taklab (`taklab-tiles.taklab-system.svc`) i plików użytkownika limit jest wyższy, np. 16 równoczesnych. Odpowiedź 429 lub 503 wydłuża przerwę. Wartości w konfiguracji. Dzięki temu działa każdy protokół, który serwer kafelków już obsługuje (ZXY, WMS przez `tileURL`, Esri), i korzysta z jego pamięci podręcznej. Brakujący kafelek (404 lub pusty) pomijamy i liczymy; po trzech nieudanych próbach innego błędu zadanie pada.
3. Zapisz kafelki do MBTiles (schemat TMS, `metadata` z `name`, `format`, `bounds`, `minzoom`, `maxzoom`, `type=baselayer`). Jeden plik MBTiles na podkład.
4. Z tych samych kafelków zbuduj PMTiles dla przeglądarki. Przy kilku podkładach: jeden plik PMTiles na podkład.
5. Obiekty: zamień migawkę GeoJSON z żądania na CoT (`CoTParser.from_geojson`, jak `resolveFeatures` w `api/stateless/lib/mission-package.ts`). Załączniki dołącz tak samo jak tam, jeśli plik o danym skrócie jest w MinIO. Brak pliku (np. załącznik cudzego obiektu) nie przerywa zadania.
6. Złóż paczkę danych `DataPackage` z `@tak-ps/node-cot`: pliki MBTiles i CoT, manifest z nazwą paczki i UID paczki = `id`.
7. Odłóż w MinIO pod `area-package/<id>/`: `package.zip`, `<basemap>.pmtiles`. Ustaw `size`, `status=Success`.

Postęp to odsetek pobranych kafelków. Zadanie przerwane restartem poda wraca do `Pending` i zaczyna od nowa.

### Przeglądarka

- Narzędzie zaznaczania prostokąta korzysta z istniejącego trybu rysowania (`stores/modules/draw.ts`), ale nie zapisuje kształtu jako obiektu.
- Okno wyboru: wszystkie obiekty w obszarze z lokalnej bazy Atlas (`workers/atlas-database.ts`) — własne, z misji i ze strumienia — bez pozycji ludzi (urządzenia i kontakty: obiekty z `__group` albo z `contact` z adresem połączenia w szczegółach CoT; budowniczy przenosi to kryterium z tego, jak CloudTAK już odróżnia kontakty). Kryterium „widoczny” = obiekt, który jest teraz rysowany na mapie, czyli nie ukryty filtrem ani wyłączoną warstwą. Szacunek rozmiaru = liczba kafelków × stały średni rozmiar kafelka dla formatu (np. 15 kB PNG, 25 kB JPEG). To szacunek, okno podaje go z tyldą.
- Suwak z dwoma uchwytami jako nowy komponent (Tabler nie ma takiego). Zakres i krok = 1 poziom przybliżenia.
- Lista „Paczki obszarów” w menu plików: nazwa, stan z postępem, rozmiar, kod QR (biblioteka QR już użyta w `DataSyncQrModal`), link do skopiowania, „Zapisz offline w tej przeglądarce”, „Usuń” z potwierdzeniem.
- „Zapisz offline w tej przeglądarce” pobiera plik PMTiles do OPFS i dodaje go jako warstwę offline. Używa mechanizmu z `utils/offline-tiles.ts` i `stores/modules/offline-tiles.ts`, który dziś obsługuje zasoby profilu (`/api/profile/asset/<id>.pmtiles`). Trzeba go rozszerzyć o drugi rodzaj źródła; budowniczy decyduje, czy przez osobny wzorzec adresu, czy przez zapis paczki jako zasobu profilu.
- Po wciśnięciu „Zapisz” przeglądarka czeka na koniec zadania i sama pobiera PMTiles do OPFS. To realizuje „zapisz do cache” bez dodatkowego kliknięcia. Przycisk na liście zostaje na wypadek innej przeglądarki albo skasowanej pamięci.
- Teksty przez `t()` z kluczami w polskim i angielskim pliku tłumaczeń.

### Charty taklab

- Adres publiczny paczki to `https://<env>-mapa.taklab.eu/api/public/area-package/<token>.zip`. Trasa `/api` już idzie do usługi CloudTAK, więc nowej reguły Traefika nie trzeba. Sprawdzić, czy polityka sieciowa pozwala `<env>-cloudtak-events` łączyć się z `<env>-cloudtak-tiles:5002`, i dopisać regułę, jeśli nie.
- Kwota zasobów: proces roboczy zużywa więcej pamięci i miejsca na dysku przy składaniu paczki. Pliki tymczasowe na `emptyDir` z limitem.
- Limit miejsca w MinIO: sprawdzić rozmiar woluminu `<env>-cloudtak-magazyn`.

## Ograniczenia

- Podkłady wektorowe (MVT) nie wchodzą do paczki w pierwszej wersji. ATAK nie wyświetla wektorowego MBTiles. Okno pokazuje je jako niedostępne z wyjaśnieniem.
- Google rozpoznajemy po hoście adresu podkładu (`*.google.com`, `*.googleapis.com`, `*.gstatic.com`). Sprawdzamy to po stronie serwera, nie tylko w oknie.
- Limit jednej paczki: 100 000 kafelków i 2 GB, jako wartości konfiguracyjne z tymi domyślnymi. To moja propozycja, do potwierdzenia. Plik 2 GB to dużo dla telefonu, a pobranie przez ATAK idzie jednym strumieniem bez wznawiania.
- Kod w forku po angielsku, teksty dla ludzi po polsku. Fork jest publiczny (AGPL).

## Moje decyzje (do sprawdzenia przy czytaniu)

- Nakładki rastrowe włączone na mapie trafiają do grupy „Podkłady” razem z podkładem. Dotyczy to także plików wgranych przez użytkownika (tryb nakładki `profile`, np. GeoTIFF zamieniony na PMTiles, serwowany pod `/tiles/profile/:username/:file/...`). Żądanie niesie więc źródło warstwy (`basemap` z `id` albo `profile` z nazwą pliku), a proces roboczy pobiera kafelki z odpowiedniej trasy serwera kafelków.
- Jeden suwak na każdy podkład, nie jeden wspólny.
- Proces roboczy w `tasks/events`, nie osobne wdrożenie.
- Kafelki przez serwer kafelków v14, nie prosto od dostawcy.
- Po zakończeniu zadania przeglądarka sama zapisuje PMTiles offline.
- Limity: 100 000 kafelków, 2 GB.

## Do decyzji budowniczego

- Biblioteka do zapisu MBTiles (SQLite w Node) i PMTiles (np. konwersja z MBTiles narzędziem `pmtiles` albo zapis bezpośredni).
- Dokładny kształt tras wewnętrznych dla procesu roboczego.
- Wygląd suwaka i listy paczek w ramach stylu Tabler.
- Średnie rozmiary kafelków do szacunku.

## Weryfikacja

- Testy jednostkowe: liczenie kafelków w prostokącie, odrzucenie Google i wektorów, trasa publiczna (404 dla nieznanego, nieukończonego i skasowanego), manifest paczki.
- Test procesu roboczego na małym obszarze z atrapą serwera kafelków: poprawny MBTiles (schemat TMS) i zip z manifestem.
- Na emulatorze ATAK: zeskanowanie kodu albo `adb shell am start -a android.intent.action.VIEW -d 'tak://com.atakmap.app/import?url=…'`, import, mapa widoczna w warstwach, obiekty na mapie po wyłączeniu sieci.
- W przeglądarce: zapis offline, potem wyłączenie sieci w DevTools i przewijanie mapy w obszarze.
