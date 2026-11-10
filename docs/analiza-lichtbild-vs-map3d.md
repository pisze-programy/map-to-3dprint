# Lichtbild vs. `map-to-3dprint` — pełna analiza techniczna

Data: 2026-11-10. Dokument zbiera całość: architekturę, dane, geometrię, kolory, eksport, render
i listę braków — z odnośnikami do kodu po obu stronach.

**Jak czytać odnośniki**

- `[my] src/plik.js:123` — nasz kod, numer linii w repo.
- `[them] c__app-*.js mod 49391` — publiczny bundle ich strony (Next.js/webpack), numer **modułu
  webpack** + cytowany string. To jedyny „kod", do którego mamy dostęp; to kod klienta, nie backend.
- `[them/API]` — odpowiedź publicznego endpointu (jest w stanie odtworzyć każdy).
- **Potwierdzone** = widziałem w kodzie/odpowiedzi/obrazie. **Wnioskowane** = oznaczam wprost.

---

## 1. Metodyka i granice

Sprawdzone:

- 31 chunków JS ich strony (~1,84 MB), w tym 10 lazy chunków wyliczonych z mapy webpack runtime.
- Publiczne endpointy: `/api/data-licenses`, `/api/geocode-v3`, `/api/exchange-rates`,
  `/api/createCity`, `/api/image`, `/api/mcp/*`, `/.well-known/*`.
- Dwa **realne podglądy** wygenerowane przez ich publiczny connector MCP (`design_3d_city_model` +
  `render_model_preview`) — Stuttgart 20 cm i Zugspitze 20 cm; obrazy pobrane i zbadane
  (wymiary, czas, kompozycja tła, geometria w powiększeniu).
- Nasz kod: `mesh_builder.js`, `exporters.js`, `webgl_studio.js`, `ui_app.js`, `gis_pipeline.py`,
  `fetch_gis.py`, `server.py`, `template.html`.

Czego **nie** wiem:

- Jak wygląda ich plik produkcyjny (STL/3MF) — nie ma publicznego eksportu. Wszystko o ich druku to
  wnioski z renderów i opisów produktu.
- Jaki silnik renderuje ich podglądy (WebP bez metadanych).
- Czy ich plik jest z-bandowany w Z, czy to jedna bryła z regionami materiałów.

---

## 2. Architektura — zestawienie

| Warstwa | My | Oni |
| :--- | :--- | :--- |
| Frontend | statyczny `index.html` (bundlowany `build_app.py`), zero zależności | Next.js (pages router) na Vercel, 14 języków |
| Render 3D w kliencie | własny WebGL 1.0: `[my] webgl_studio.js:289` (shadow map 2048), PCF 9-tap `:161`, raycast Möller–Trumbore `:573` | **brak** — zero three.js/WebGL/maplibre w 31 chunkach |
| Mapa 2D | własne rastrowe kafle OSM FR / Esri `[my] ui_app.js:238,241` | **Leaflet** + Stadia Alidade Satellite `[them] mod 13769, 37275, 38041, 80942` (`tiles.stadiamaps.com/tiles/alidade_satellite/{z}/{x}/{y}.jpg`) |
| Geokodowanie | Photon (Komoot) przez proxy `[my] server.py:62` | `/api/geocode-v3` `[them] mod 24984` — format odpowiedzi = OpenCage (DMS, MGRS, Maidenhead, Mercator, NUTS, UN_M49, linki OSM) |
| Dane GIS | AWS Terrarium DEM z14 + OSM Overpass `[my] fetch_gis.py:118,162` | OSM + GeoNames + lidar krajowy (3DEP, ALKIS/ATKIS, OSNI, NRCan, Queensland) + Mapterhorn `[them/API] /api/data-licenses` |
| Generowanie geometrii | **w przeglądarce** (`buildComplete3DModel`) | **na serwerze** (`POST /api/createCity`, strumień postępu) |
| Podgląd | interaktywny WebGL, obrót/zoom/picking budynków | 2 statyczne obrazy 1400×1400 WebP (table/wall) |
| Koszyk | brak | Shopify (`gid://shopify/ProductVariant/...` `[them] mod 70931`), `/api/checkout` |
| Cennik | brak | tabela w bundlu `[them] mod 69382` |
| Connector AI | brak | MCP `https://mcp.lichtbild.com` + OAuth metadata `[them/API] /api/mcp/oauth/metadata` |
| Atrybucja danych | brak | `/api/data-licenses` (648 KB, per model) `[them] mod 51509` |

---

## 3. Dane wejściowe

### 3.1 Wysokości

- **My:** AWS Terrarium (`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`),
  `zoom=14` `[my] fetch_gis.py:118`, siatka 64–72 px `[my] fetch_gis.py:99`,
  `[my] gis_pipeline.py:123`. To globalny DEM ~30–90 m/px zależnie od szerokości.
- **Oni:** ten sam OSM, ale wysokości z **najlepszego dostępnego źródła per kraj**: USGS 3DEP/lidar,
  Mapterhorn, ATKIS-DGM1, OSNI lidar, NRCan, Alberta, Queensland — pełna lista w
  `/api/data-licenses` (m.in. „U.S. Geological Survey, 3D Elevation Program (3DEP), Lidar-Projekt
  …", „Mapterhorn (mapterhorn.com), Höhendaten aus offenen Quellen", „ATKIS-DGM1 Sachsen-Anhalt").
- **Konsekwencja:** dla Niemiec/USA/AU ich relief ma dane 1 m, nasz ~30 m. To różnica klasy
  produktu („topographic precision" vs. „generyczny DEM").

### 3.2 Wektory

- **My:** Overpass QL `[my] fetch_gis.py:162` — budynki, `building:part`, woda, rzeki, parki, lasy,
  drzewa, drogi, mosty; ring stitching i uproszczenie `[my] gis_pipeline.py:22,75`; linie wodne
  `[my] gis_pipeline.py:393–400`.
- **Oni:** to samo źródło (OSM, ODbL) + **kadaster lokalny** (np. „ALKIS Liegenschaftskataster Kreis
  Wesel", „Berliner Gebäude Atlas", „Ipswich Cadastral") → dokładniejsze footprinty w niektórych
  regionach.

### 3.3 Geokodowanie

- My: Photon, limit 6 `[my] server.py:62–80`; autocomplete po stronie klienta `[my] ui_app.js:4`.
- Oni: własny `/api/geocode-v3` z anotacjami OpenCage (widoczne w odpowiedzi dla „Stuttgart":
  `DMS`, `MGRS`, `Maidenhead`, `Mercator`, `NUTS`, `UN_M49`, `OSM.edit_url`). Mają też
  `country_hint` w narzędziu MCP.

### 3.4 Kafelki mapy

- My: `tile.openstreetmap.fr/hot` + Esri World_Topo_Map `[my] ui_app.js:238,241`, własny renderer
  kafli na canvasie (bez Leaflet).
- Oni: Leaflet + Stadia Alidade Satellite, `@2x` na retina, `maxZoom` 16–20, atrybucja
  „© CNES, Distribution Airbus DS, © Airbus DS, © PlanetObserver (Contains Copernicus Data)".

---

## 4. Geometria — warstwa po warstwie

### 4.1 Układ współrzędnych i skala wewnętrzna

- My: sześcian roboczy `±84,5` (`169 × 169`), maski rastrowe 320² `[my] mesh_builder.js:503`,
  siatka terenu 68×68 `[my] mesh_builder.js:675`, `baseBottomZ = 2.45` `[my] :706`,
  `maxReliefMm = 7.4` `[my] :707`, `elevSpan = max(12, …)` `[my] :708`,
  `numContourSteps = 18` `[my] :710`.
- Oni: brak dostępu; z renderów: model w ramie, boki pionowe do wspólnej podstawy, teren schodkowy.

### 4.2 Teren

- My: Marching Squares po `zGrid`, kwantyzacja do 18 progów `[my] mesh_builder.js:751–758`,
  „fast path" dla komórek w jednym progu `:836–848`, risery `:862–900`, fartuch na obrzeżach
  `:918–936`. Relief jest **normalizowany**: `hMm = relE/elevSpan * maxReliefMm` `:724`, czyli
  każdy obszar dostaje maks. 7,4 jednostki wysokości niezależnie od realnej różnicy (13 m czy
  2000 m). `elevSpan = max(12, maxElev-minElev)` `:709`.
- Oni: teren schodkowy widoczny w renderze (regularne „warstwice" na zboczach), strefy łąka → skała
  → śnieg. Przy 20 cm = 15 km (Zugspitze) relief w renderze to ~10–15 % szerokości (szacunek
  z obrazu), czyli blisko skali 1:1 (1:75 000); nasz model przy 1,2 km i 20 cm ma 1:6 000, więc
  **góry muszą być u nas spłaszczone** — i są (7,4 j. = 4,4 % szerokości przed `terrainScale`).

**Wniosek:** to nie jest kosmetyka. Ich produkt ma **dwa reżimy pokrycia** (miasto 1 km², góra
225–1750 km²), nasz ma jeden (~1,2 km) → dla gór nasz relief jest 10–30× bardziej spłaszczony.

### 4.3 Woda

- My: 3-poziomowa batymetria: `deepWaterZ = 1.76` `[my] mesh_builder.js:765`, półki
  `[1.98, 2.20]` `:776`, dno i ściany `:768–773`, wyspy `:826–830`. Warstwa jest **domknięta**
  (dno w `z=0`, ściany, górna powierzchnia).
- Oni: płaski poligon lekko pod gruntem, kolor z palety (`#A3D8E1`), bez batymetrii w podglądzie.

### 4.4 Zieleń i drzewa

- My: maska `greenMask` z OSM `[my] mesh_builder.js:592–616`; dla płaskiej komórki powstaje
  **jeden quad** `gZ = tZ + 0.28` `[my] :846` — bez ścian, bez dna. Drzewa: stożek 5-boczny
  `[my] :410–431`, start `zGround - 0.05` `:412`, bez podstawy; pozycje `:940–950`, promień
  zależny od `scaleToBed` `:947`.
- Oni: zieleń jako płaskie poligony pod drzewami; drzewa jako **gęste instancje low-poly** (klastry
  w parkach, rzędy wzdłuż ulic) — w renderze tysiące sztuk, wyglądają na domknięte bryły.

### 4.5 Drogi

- My: `pushQuad` top + 2 boki `[my] mesh_builder.js:1004–1006`; `zTop = terrainZ + 0.34`,
  `zBot = zTop - 0.40` `:997–998`; mosty z pomostem i filarami `:955–1027`; brak dna i zamknięć
  końców. Oznaczeń jezdni **nie ma**.
- Oni: płaskie wstęgi na gruncie, kolor jasny, **białe przerywane oznaczenia jezdni modelowane**
  (widoczne w powiększeniu renderu), estakady/nasypy.

### 4.6 Budynki

- My: `extrudeBuildingLoD2` `[my] mesh_builder.js:298–408`: ściany zewnętrzne, ściany dziedzińców,
  dach LoD2 (hip/gable/pyramid/dome) metodą „centroid lift" `:354–390`; brak dna — bryła jest
  wpuszczona 0,15 w teren (`zBase = terrainZ - 0.15` `:1163`).
  Filtry: min. rozpiętość 0,55 j., pole 0,45 j.² `:1057`; clamp proporcji „anti-matchstick"
  `:1153–1156`; `epsZ` 0,012·(i%11) przeciw z-fightingowi `:1157`.
- Oni: ekstruzja footprintów, **dachy płaskie**, drobne bryły na dachach (kominki/HVAC), dziedzińce;
  brak okien i tekstur. Edycja per budynek: `markedBuildings`, `customBuildings`, `editedBuildings`,
  `deletedBuildings` w konfiguracji `[them] mod 49391` (`toModelConfig`).
- **Przewaga nasza:** dachy LoD2. **Przewaga ich:** spójna, domknięta bryła i edycja pojedynczych
  budynków w produkcie.

### 4.7 Ramka

- My: ramka 45° `innerR = 84.85`, `outerR = 94.5`, `z = -1.6 … 3.55` `[my] mesh_builder.js:1186–1200`.
  Renderowana w studiu `[my] webgl_studio.js:326,446,467,556`, ale **nieeksportowana**
  (`exporters.js:121–128` ma 6 warstw, bez `frame`).
- Oni: ramka jest częścią produktu (czarna/biała, aluminium? — w renderze matowa czerń), plus
  **pokrywa akrylowa** i **grawerowana plakietka**.

### 4.8 Domknięcie brył — tabela faktów

| Warstwa | Nasza topologia | Domknięta? | Skutek w slicerze |
| :--- | :--- | :--- | :--- |
| Woda | dno `z=0` + półki + ściany `:765–830` | **tak** | OK |
| Teren/base | heightfield + fartuch do `z=0`, **bez dna** `:918–936` | nie | otwarte na stole; zwykle akceptowalne, ale nie „watertight" |
| Zieleń | **jeden quad** `:846` | **nie — 0 grubości** | warstwa wisi 0,28 nad terenem; w slicerze nic/pojedyncza warstwa |
| Drzewa | stożek bez podstawy `:410–431` | nie | otwarty kontur, pierwsza warstwa „w powietrzu" |
| Drogi | top + 2 boki `:1004–1006` | nie | brak dolnych warstw i zamknięć |
| Budynki | ściany + dach, wpuszczone 0,15 w teren `:1163` | nie (celowo) | nakładka z terenem → podwójna ekstruzja w strefie styku |
| Ramka | 4 mity `:1186–1200` | tak | **nieeksportowana** |

`README.md:5` twierdzi „six separate manifold volumes", a `README.md:36` mówi o 12 terasach —
kod ma 18 (`mesh_builder.js:710`). `README.md:160` deklaruje SSAO — w `webgl_studio.js` nie ma
żadnego AO (tylko shadow map + „studio illumination" `:242–243`). Dokumentacja wyprzedza kod.

---

## 5. Kolory i materiały

### My

- 4 presety w `[my] ui_app.js:10–57`, np. „Lichtbild Studio": `water #…`, `base #…`,
  `greenery #…`, `roads #f4f3ef`, `buildings #faf9f5`, `highlighted #f59e0b`
  (`:12–22`), „Classic White & Gold" `:24`, „Nordic Slate" `:36`, „Alpine Relief" `:48`.
- Kolor jest tylko do podglądu/druku; brak mapowania na konkretne filamenty.

### Oni

- `[them] mod 49432`: `ColorSchemeType = {granite, pastell, water_only, white}`; schematy mają
  **dwie wartości na warstwę** — `ams` (kolor filamentu) i `render` (kolor podglądu):
  ```
  PASTELL: buildings #FFFFFF, floors #E8DBB7, water #A3D8E1, grass #61C680, snow #FFFFFF
  ```
  Warstwy: `buildings, floors, water, grass, snow, route, markedBuildings`.
- `[them] mod 21250`: `calculateDiscount(qty) { return 0 }` — rabaty ilościowe wyłączone, mimo że
  hinty „1/2/3+" istnieją. Warianty Shopify: `{terrain, hearth, colorful, size} → variantId`
  (np. `54552383357272` = MEDIUM/pastell?), kilkadziesiąt SKU.

### Cennik (`[them] mod 69382`)

| Rozmiar | Baza | + pastell/granite | + polar | Marker budynku | GPX (góra) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 14 cm (SMALL) | 59 € | +10 € | +5 € | +10 € | +10 € |
| 20 cm (MEDIUM) | 69 € | +19 € | +10 € | +10 € | +15 € |
| 26 cm (BIG) | 99 € | +29 € | +15 € | +10 € | +19 € |
| 33 cm (SIZE_33) | 159 € | +39 € | +19 € | +10 € (góra: 0 €) | +29 € |
| 52 cm (XL) | 299 € | +69 € | +39 € | +39 € | 0 € |
| 24 cm (TILE) | 79 € | +19 € | +10 € | +10 € | +19 € |

Ceny identyczne dla miasta i góry (różni się tylko GPX). `medium + pastell = 88 €` — MCP zwrócił
„about 89 EUR", czyli spójne.

---

## 6. Skala, rozmiary, podział na płyty

### My

- Model zawsze **170 jednostek = `bedSizeMm`** `[my] exporters.js:107–108`,
  `scaleMm = bedSizeMm/170`, `offsetMm = bedSizeMm/2`. Czyli **100 % łoża, zero marginesu**.
- 4 opcje łoża: 330 (Prusa XL), 256 (Bambu X1C/P1S), 350 (Voron), 520 („Format XL 4-Kafle")
  `[my] template.html:62–65` — ale 520 **nie dzieli** modelu, tylko skaluje do 52 cm.
- Kadr: `cropRatio 0.88` `[my] ui_app.js:124`; suwak 0,55–0,98 `[my] template.html:152`,
  UI pokazuje `crop*1.35` km `[my] ui_app.js:1235` → realnie ~0,74–1,32 km, domyślnie **1,19 km**;
  `metersToUnits = 170/span_m` `[my] gis_pipeline.py:240`.
- Skala: ~1,2 km na 330 mm ≈ **1:3 600**; na 256 mm ≈ 1:4 700.

### Oni

- `Size` enum `[them] mod 52373`: `SMALL=0, MEDIUM=1, BIG=2, XL=3, TILE=4, SIZE_33=7`;
  `sizeToString`: `14x14cm, 20x20cm, 26x26cm, 33x33cm, 52x52cm, 24x24cm`.
- `printerTypeForSize`: **33 cm → `A2L`**, pozostałe → `A1`.
- Pokrycie: miasto 20 cm = 1,00 km², 26 = 1,78, 33 = 2,97, 52 = 7,72 (4 płyty 2×2);
  góra 20 cm = 225 km² (15 × 15 km), 26 = 400, 33 = 667, 52 = 1750.
- Płyty: `TILE = 24 cm`, assety sceny `/panorama/scene-floor.png`, `scene-foreground.png`
  `[them] mod 5107` — sklejanie modułów w jedną kompozycję, osobne ramki.

**Wniosek:** oni mają dwa reżimy pokrycia i realny split 2×2; my mamy jeden kadr i skalujemy
wszystko do łoża. Stąd „4-Kafle" u nas to etykieta bez implementacji.

---

## 7. Eksport — analiza `exporters.js`

### 7.1 `.3mf` (`[my] exporters.js:106–196`)

| Element | Stan | Konsekwencja |
| :--- | :--- | :--- |
| Jednostka | `unit="millimeter"` `:167` | OK |
| Kolor | `basematerials` + `pindex` per obiekt `:171–177` | OK |
| Kolor per trójkąt | `pid="10" p1="${matIdx}"` `:151` | zgodne ze spec, ale nadmiarowe |
| Wierzchołki | **3 nowe na każdy trójkąt** `:142–152` | ~3× więcej XML niż potrzeba |
| Kompresja ZIP | **store (0)** `:44` | brak deflate |
| Rozmiar (Tokio, 163 877 tri) | ~22 MB wierzchołki + ~12 MB trójkąty | **~30 MB+** na plik |
| Ramka | brak `:121–128` | produkt bez ramy |
| Margines łoża | brak `:107` | brim/skirt nie wchodzi |
| Walidacja | brak | plik zawsze „się udaje" |

### 7.2 `.stl` (`[my] exporters.js:198–238`)

- Wszystkie warstwy w jednym pliku `:202–204` → **jeden kolor**.
- `layerId` w „attribute byte count" `:231` — slicery tego nie czytają.
- Brak ramki, brak marginesu, brak walidacji; rozmiar poprawny (50 B/tri).

### 7.3 Czego w eksporcie nie ma w ogóle

- Podziału na płyty i jointów (kołki/jaskółczy ogon) z tolerancją 0,15–0,2 mm.
- Ramki, plakietki, pokrywy akrylowej jako osobnych obiektów.
- Profili druku (dysza, layer height, temperatury, flow, brim, support).
- Preflight: manifold, min. ściana 0,45 mm, zero-area, floating shells, fit do łoża.
- Eksportu po stronie serwera/CLI (tylko przeglądarka) → brak batcha, brak kolejki, brak API.

### 7.4 U nich

Publicznego eksportu **nie ma** — produkują w Stuttgarcie i wysyłają w ~tydzień. Z tego, co widać:
- plik jest najpewniej **jedną spójną bryłą** (albo z-bandowaną), bo render nie pokazuje szczelin
  ani nakładek;
- kolor per region = filament per region (AMS), więc nie potrzebują 6 osobnych obiektów;
- 52 cm = 4 płyty 2×2 z ramkami (`TILE 24 cm` + „assembled from 4 plates");
- klasy A1/A2L dobierane do rozmiaru → świadoma decyzja „co się mieści".

---

## 8. Podgląd i render

### My — WebGL w przeglądarce

- `[my] webgl_studio.js:289` shadow map 2048², PCF 9-tap `:161–169`, studio lighting `:242–243`,
  raycast Möller–Trumbore `:573`, warstwy + ramka `:326/446/467/556`, kolory ramki `:513–517`.
- Zaleta: interakcja, picking budynków, natychmiastowa zmiana kolorów/rozmiaru.
- Wada: jakość „gry", brak fotorealizmu; SSAO z README nie istnieje.

### Oni — render serwerowy

- `POST /api/createCity` `[them] mod 49391`: body
  `{config, configuratorItem, colorschemes, language, requestId, panorama, cleanView, …}`;
  odpowiedź to **strumień tekstowy**: `keep-alive`, `PROGRESS <n>`, finał `"<id1>;<id2>"`.
- Parametry: `stallMs 20000`, `maxResumes 3`, `resumeDelayMs 1000`, `staleOnReturnMs 10000`,
  timeout frontu 5 min; błędy → `POST /api/previewError` z kontekstem.
- Obrazy: `https://www.lichtbild.com/api/image?id=<ts>-<uuid>-<idx>-<b64>.webp`,
  **1400×1400, ~80–110 KB**, dwa widoki (table/wall), watermark.
- Czas: pierwszy poll po ~25 s (47 %/90 %), gotowe po ~40–65 s.
- Kompozycja: tło studyjne **stałe** — PSNR narożników między podglądem miasta i góry: 47–52 dB
  (praktycznie identyczne piksele), całość ~17 dB (różni się tylko model). Model doklejany z cieniem.
- Modal: CSS 2.5D na `/panorama/scene-floor.png` + `scene-foreground.png` `[them] mod 5107`.

---

## 9. Sklep i integracje (czego u nas nie ma)

- **Shopify**: line items `gid://shopify/ProductVariant/<id>` `[them] mod 70931`, `/api/checkout`,
  warianty w bundlu `[them] mod 21250`.
- **Cennik**: `[them] mod 69382` (tabela wyżej), rabaty = 0.
- **Czas produkcji / priority production**: „Standard Monday, November 16; Priority Wednesday,
  November 11" — obietnica daty w konfiguratorze.
- **MCP**: `https://mcp.lichtbild.com` = `/api/mcp/shop`; narzędzia `search_places`,
  `design_3d_city_model`, `design_3d_mountain_model`, `render_model_preview`, `get_render_status`,
  `get_order_link`, `get_product_info`. OAuth metadata publikowane, ale `tools/list` działa bez
  auth (świadome — „needs no account").
- **Atrybucja**: `/api/data-licenses` zwraca per model listę źródeł (ODbL, CC BY, domena publiczna).
- **Brak UCP/ACP**: `/.well-known/ucp`, `/.well-known/agentic-commerce`, `api/ucp` → 404.
  Brak też `cart.js`, `products.json` (to nie klasyczny storefront).

---

## 10. Luki i plan

### P0 — bez tego nie ma druku (1–2 dni)

| # | Co zrobić | Gdzie | Odpowiednik u nich |
| :-- | :--- | :--- | :--- |
| 1 | Zieleń jako płyta `terrainZ → +0.28` (top + 4 ściany) | `mesh_builder.js:846` | jedna spójna bryła |
| 2 | Drogi: dodać dno i zamknięcia końców | `mesh_builder.js:1004–1006` | to samo |
| 3 | Drzewa: dodać podstawę | `mesh_builder.js:410–431` | drzewa jako bryły |
| 4 | Teren: dno w `z=0` (albo świadomie „open bottom" + dokumentacja) | `mesh_builder.js:918–936` | — |
| 5 | Preflight: manifold per warstwa, zero-area, liczba shells, min. ściana 0,45 mm, bbox vs łoże | nowy `src/validation.js` + hook w `ui_app.js:1357` | brak publiczny (mają własną kontrolę jakości) |
| 6 | Margines łoża 5 mm (`scaleMm = (bed - 2*margin)/170`) | `exporters.js:107` | ich model mieści się w ramie/płytach |

### P1 — produkt (ok. tygodnia)

| # | Co zrobić | Gdzie | Odpowiednik u nich |
| :-- | :--- | :--- | :--- |
| 7 | Split 2×2 + joints (kołki/jaskółka, 0,15–0,2 mm) | nowy moduł + `exporters.js` | 4 płyty 2×2, `TILE 24 cm` |
| 8 | Ramka i plakietka jako osobne obiekty w 3MF/STL | `mesh_builder.js:1186`, `exporters.js:121` | ramka + akryl + plakietka |
| 9 | Profile per maszyna (XL/Bambu/Voron/520): dysza, layer height, flow, brim; terasy jako wielokrotność warstwy | `ui_app.js:123`, `mesh_builder.js:710` | klasy A1/A2L |
| 10 | 3MF: dedupe wierzchołków + deflate (metoda 8) | `exporters.js:21–90,142–152` | nieznane |
| 11 | Kolor `render` + `filament` (AMS hex) osobno w palecie | `ui_app.js:10–57` | `mod 49432` (`ams`/`render`) |
| 12 | Oznaczenia jezdni jako cienkie wyspy | `mesh_builder.js:1004` | widoczne w ich renderze |

### P2 — sklep (później)

13. Render 2 widoków (table/wall) + stałe tło + cień — jak u nich; u nas WebGL zostaje do konfiguracji.
14. Cennik per rozmiar/kolor i lead time; kolejka produkcyjna.
15. Atrybucja danych per model (ODbL/CC BY) — `/api/data-licenses` jako wzór.
16. Podział na strefy pokrycia: miasto ~1 km², góra 10–20 km (`cropRatio` + `size`).
17. Domykanie `README` do kodu (18 teras, brak SSAO, zieleń nie jest bryłą, zakres kadru).

---

## 11. Co kopiować, a czego nie

**Kopiować**

1. Dwa reżimy pokrycia (miasto 1 km², góra 15 km) — bez tego góry u nas nie mają reliefu.
2. Dwie wartości koloru na warstwę (`ams` + `render`).
3. Split 2×2 z ramkami per moduł i klasami maszyn (A1/A2L).
4. Z-bandowany, domknięty model zamiast 6 otwartych objektów.
5. Render 2 widoków na stałym tle (tanie, skuteczne w sklepie).
6. Oznaczenia jezdni i instancje drzew (mamy drzewa, brak oznaczeń).
7. Atrybucja per model.

**Nie kopiować**

- Płaskie dachy budynków — nasz LoD2 to przewaga.
- Statyczny „3D preview" jako jedyny podgląd — nasze studio jest lepsze do konfiguracji.
- Brak batymetrii w podglądzie — my mamy 3 poziomy.
- Rabaty ilościowe „na papierze" (`calculateDiscount → 0`) — albo działa, albo nie ma.

---

## 12. Ryzyka i zastrzeżenia

- **Ich plik produkcyjny jest nieznany.** Wnioski o „jednej bryle" i z-bandowaniu opieram na
  renderach i opisie produktu, nie na pliku.
- **Nasza walidacja nie istnieje** — dopóki jej nie ma, każda zmiana w `mesh_builder.js` jest
  „na wiarę"; pierwszy wydruk może ujawnić rzeczy, których nie widać w studiu (zieleń, drzewa,
  drogi).
- **Skala reliefu** jest u nas normalizowana (`maxReliefMm`), więc porównanie „topograficzności"
  z Lichtbild wypada źle dla gór — to nie bug, to decyzja projektowa do zmiany.
- **Brak podziału na płyty** oznacza, że 52 cm u nas to jeden model 520 mm; przy łożu 256 mm
  produkt fizycznie nie istnieje.
- **README kłamie w 4 miejscach** (manifold, 12 teras, SSAO, zakres kadru 0,60–1,35 km zamiast
  0,74–1,32 km) — jeśli to idzie do klienta/na GitHub, warto poprawić przed publikacją.
