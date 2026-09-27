# Budynki 3D z Cesium ion: wynik próby

Data: 2026-09-28
Plan: `docs/superpowers/plans/2026-09-27-ion-3dtiles.md`, Task 0

## Jak mierzyłem

Próba nie szła w lokalnym CloudTAK, tylko na osobnej stronie Vite z tymi samymi wersjami bibliotek
co w planie: maplibre-gl 5.24.0, deck.gl 9.4.0 (`MapboxOverlay` w trybie przeplatanym, `Tile3DLayer`),
loaders.gl 4.5.2. Lokalny CloudTAK wymaga podpiętego serwera TAK i logowania, a pytania próby
dotyczą samego rysowania. Markery CoT zastępuje warstwa `circle` MapLibre z dwoma punktami.

Widok: Warszawa, okolice Pałacu Kultury (52,2318 N, 21,0067 E), zoom 16,5, pochylenie 60°,
obrót 30°. Token ion z `~/.keys/cesium-ion.token`. Przeglądarka: Chrome sterowany przez Playwright.

Zrzuty robiłem na programowym rendererze SwiftShader. Na GPU (RTX 3060) w trybie headless obraz
WebGL nie trafiał do zrzutu, a backend Vulkan psuł kompilację shaderów samego MapLibre, także bez
deck.gl. Liczby kafli mierzyłem na GPU z backendem OpenGL (`--use-angle=gl`).

## Wyniki

| # | Pytanie | OSM Buildings (96188) | Google Photorealistic (2275207) |
|---|---|---|---|
| 1 | Czy budynki się rysują | **Nie bez poprawki.** Po poprawce 1 (niżej) tak: 46 kafli do poziomu 14 | Tak: 187 kafli w 90 s na GPU |
| 2 | Czy marker za budynkiem jest zasłonięty | Nie. Marker rysuje się zawsze na wierzchu | Nie. Jak obok |
| 3 | Czy kafle potomne Google z `session` wracają 200 | nie dotyczy | Tak. Potomne `.json` i `.glb` wracają 200. Pojedyncze 404 (1 na 187) bez wpływu na obraz |
| 4 | Rzut kuli ziemskiej | Przy zoomie 16,5 obraz identyczny jak w Mercatorze: MapLibre przechodzi na płaski rzut przy dużym zbliżeniu | nie mierzone osobno, ten sam mechanizm |
| 5 | Teren MapLibre | Bez poprawki 2 budynki są przesunięte. Z terenem i poprawką 2 stoją na swoich obrysach | nie mierzone osobno, ten sam mechanizm wysokości |
| 6 | Rozmiar chunków JS | nie mierzone na stronie próby. Zmierzy Task 5 Step 5 na buildzie CloudTAK | |

### Poprawka 1: bryły ograniczające obejmujące cały glob (OSM Buildings)

Korzeń OSM Buildings i jego dwoje dzieci mają `boundingVolume.region` rozpięty na całą długość
geograficzną. loaders.gl zamienia taki region na zdegenerowany prostopadłościan (środek na długości
180°, 5,7 tys. km pod powierzchnią). Kamera nad Warszawą wychodzi wtedy 7 600 km od korzenia,
błąd ekranowy korzenia wynosi 8, czyli równo próg, i przejście drzewa nie schodzi niżej. Wybrane
kafle: 0, zapytania o kafle: 0.

Działa podmiana w pobranym JSON-ie tilesetu: każdy `region` szerszy niż π/2 na długości albo
szerokości zamieniam na `sphere: [0, 0, 0, 6378137 + maxHeight]`. Podmianę robi własna funkcja
`fetch` w `loadOptions.fetch`. Ta sama funkcja dokleja nagłówek `Authorization`. Nowy obiekt
`Response` musi dostać pole `url` z oryginału, bo loaders.gl liczy z niego ścieżki względne.
Bez tego tileset się nie wczytuje.

### Poprawka 2: wysokość tilesetu

Kafle ion leżą na wysokości elipsoidalnej. Płaska mapa MapLibre bez terenu leży na zerze. Przy
pochyleniu 60° budynki w Warszawie odjeżdżają o kilkaset metrów w stronę kamery (zrzut
`img/2026-09-27-spike-osm-bez-poprawek.png`: iglica Pałacu Kultury stoi przy Alejach
Jerozolimskich).

- Stałe przesunięcie −135 m bez terenu (około 100 m terenu plus 34 m geoidy) przesuwa budynki
  za daleko w drugą stronę (`img/2026-09-27-spike-osm-stale-135m.png`). Teren w mieście nie jest
  płaski, więc jedna stała nie wystarcza.
- Teren MapLibre (AWS Terrain Tiles, kodowanie terrarium) plus przesunięcie tilesetu o −34 m
  (wysokość geoidy nad Warszawą) stawia budynki na obrysach (`img/2026-09-27-spike-osm-teren-geoida.png`).

Przesunięcie robi `loadOptions.tileset.modelMatrix`: translacja wzdłuż lokalnego pionu w środku
mapy. Wartość musi być obiektem `Matrix4` z `@math.gl/core`. Zwykła tablica 16 liczb cicho
wyłącza wybór kafli.

### Markery

Warstwy `circle` i `symbol` MapLibre nie używają bufora głębi, więc marker CoT za budynkiem jest
widoczny. Specyfikacja zakładała zasłanianie i to założenie było błędne. Marker zawsze na wierzchu
jest dla operatora lepszy niż marker schowany, więc nic tu nie zmieniam.

## Decyzja

Decyzja: DECK_OK z dwiema poprawkami. deck.gl rysuje oba zasoby, a sesja Google działa. OSM Buildings
wymaga poprawki 1, a oba zasoby wymagają poprawki 2 i włączonego terenu, żeby budynki stały na
swoich obrysach.

Zmiany w planie wynikające z próby są zapisane w dzienniku wykonania jako rozstrzygnięcia
i wprowadzone do Task 4, 5 i 7.
