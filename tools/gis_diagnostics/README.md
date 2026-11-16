# `tools/gis_diagnostics/` — Zadaniowy Pakiet Diagnostyczny GIS, Big-O i Eksportu

Separacyjny folder z niezależnymi plikami zadaniowymi ułatwiającymi szybkie debugowanie pobierania danych OSM/DEM, grafu zależności (DAG), złożoności obliczeniowej Big-O oraz formatów eksportu 3D (`.STL`, `.3MF`, `.ZIP`).

## Zadania diagnostyczne (CLI)

### 1. Audyt architektury modułowej, brak pętli (DAG) i gwarancja terminacji podziału `2×2`
```bash
node tools/gis_diagnostics/task_01_audit_dag_and_loops.mjs
```
Sprawdza statycznie i dynamicznie:
- brak cykli `require()` (algorytm DFS 3-kolorowy) w `src/gis_fetch/`, `src/gis_client/`, `src/Water/`, `src/mesh/`, `src/export/`,
- zgodność kolejności ładowania modułów między `build_app.py` (`index.html`, `video_studio.html`) a `tools/headless_scene_harness.js`,
- limit rozmiaru pojedynczego modułu w `src/gis_fetch/` (`< 350` linii) i brak zaszytych nazw miast,
- skończone zakończenie podziału `2×2` przy symulowanym permanentnym timeoucie (`MAX_CHUNK_SPLIT_DEPTH = 3`, strażnik `visitedBBoxKeys`).

### 2. Pomiar empiryczny złożoności obliczeniowej Big-O ($T(4N)/T(N)$)
```bash
node tools/gis_diagnostics/task_02_benchmark_big_o_scaling.mjs
```
Mierzy czas wykonania przy 4-krotnym wzroście rozmiaru wejścia i weryfikuje liniowe skalowanie $O(N)$ (brak kwadratowych pętli $16\times$):
- deduplikacja elementów między kaflami (`mergeAndDeduplicateElements`),
- wypełnianie brakujących pikseli DEM (`fillDemVoidsNearestO_G2` — transformata odległości Felzenszwalba-Huttenlochera $O(G^2)$),
- składanie pierścieni relacji (`stitchWayRingsJS` — indeks końców odcinków $O(M)$),
- parowanie `building:part` z obrysami S3DB (`createS3DBClientCollector` — siatka przestrzenna 2D),
- wiązanie dróg, mostów i wód (`finalizeOsmBridgesLayerJS` — siatka przestrzenna 2D),
- strumieniowy eksport wielokolorowego `.3MF` (`exportMultiColor3MF`).

### 3. Żywy test pobierania wielu regionów geograficznych i skal (przez lokalne proxy `server.py`)
```bash
# Domyślny zestaw zróżnicowanych obszarów (Warszawa, Zakopane/Tatry, Wenecja)
node tools/gis_diagnostics/task_03_probe_live_regions.mjs

# Debugowanie dowolnych współrzędnych użytkownika:
node tools/gis_diagnostics/task_03_probe_live_regions.mjs --lat=25.19714 --lon=55.27414 --span=12000 --title="DUBAI_TEST"
```
Wypisuje szczegółową telemetrię sesji z `__map3dFetchDiagnostics` (rozmiar siatki sektorów, czasy kafli, podziały `2×2`, liczba budynków, dróg, wód i rozdzielczość DEM).

### 4. Weryfikacja formatów eksportu (`.STL`, `.3MF`, `.ZIP`) i wariantów płyt
```bash
node tools/gis_diagnostics/task_04_verify_formats_and_plates.mjs
```
Buduje i audytuje topologicznie (`0 open edges`, `0 non-manifold edges`, `0 degenerate tris`) różne formaty i wymiary płyt:
- kwadrat `15×15 cm`, panorama `24×12 cm` z podziałem `2×2`, portret `10×16 cm` z obrotem azymutu `37°`, kompakt `12×8 cm`,
- tryb pełny, odchudzona baza SLA (`hollowBase` z żebrami 45° i drenażem), wycięcie wody (`waterCutout`) oraz ramka ścienna CSG (`showFrame`),
- eksport binarny `.STL` (bryła pełna + pojedyncze warstwy + ramka CSG), wielokolorowy `.3MF` (XML w archiwum PK-ZIP) oraz wielokaflowy pakiet `.ZIP` z instrukcją Photon Mono 4.

## Inspekcja w przeglądarce (DevTools)
W konsoli przeglądarki na `http://127.0.0.1:8765` dostępny jest rejestr diagnostyczny ostatniego pobierania:
```js
window.__map3dFetchDiagnostics.getFetchDiagnosticsReport()
```
