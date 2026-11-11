# Dlaczego ich Burj Khalifa ma iglicę, a nasza to „przedłużona podstawa z trójkątami"

Data: 2026-11-11. Odnośniki do naszego kodu: commit **`b307cd6`** (HEAD). Odnośniki do nich: publiczny
bundle + publiczne API + wygenerowany render.

---

## 0. Najpierw uczciwie: czego nie da się „przeczytać w ich kodzie"

Ich **geometria nie jest w kliencie**. W 31 chunkach JS ich strony nie ma ani jednego fragmentu
budującego bryły — jest tylko konfigurator, koszyk i odbiór obrazków (`POST /api/createCity` →
strumień → `GET /api/image?id=…`). Kod, który robi siatki, jest po stronie serwera i nie jest publiczny.

Co **jest** dostępne i wystarcza do diagnozy:

1. ich render Burj Khalify (wygenerowałem 26 cm przez publiczny connector),
2. dane OSM, na których obaj pracujemy (te same, z naszego cache),
3. nasz kod (pełny).

Z tych trzech rzeczy wynika mechanizm ich modelu — i to on odpowiada za iglicę.

---

## 1. Co pokazuje ich render (Burj, 26 cm, 1333 × 1333 m)

- wieża ma **stopniowane zwężenia** (setbacks) i **cienką iglicę** na szczycie,
- sąsiednie wieżowce to **czyste ekstruzje footprintów, płaskie dachy** — żadnych wymyślonych
  dachów spadzistych,
- brak „przebić" i zlewania się brył: to wygląda na **jeden złączony solid** na budynek,
- inne obiekty (drogi, woda, zieleń, drzewa) stykają się bez szczelin.

---

## 2. Skąd bierze się iglica — dane OSM

Burj Khalifa w OSM to relacja + **kilkadziesiąt `building:part`**. W naszym cache’u (bbox Dubaj)
jest 17 części o wysokości > 400 m:

```
height   min_height   footprint (min. szerokość)   typ
828 m    –             ~1,1 m                      building:part   ← iglica
760 m    –             ~3,9 m                      building:part
740 m    –             ~4,0 m                      building:part
720 m    –             ~3,8 m                      building:part
710 m    –            ~15,0 m                      building:part
700 m    –             ~9,1 m                      building:part
680 m    –            ~10,4 m                      building:part
660 m    –             ~7,7 m                      building:part
645 m    –            ~13,7 m                      building:part
625 m    –            ~10,1 m                      building:part
605 m    –            ~13,1 m                      building:part
591 m    –           ~148,5 m                      building (outline relacji)
580…405 m –           12–20 m                      building:part
```

**Kluczowe: w tych danych nie ma ani jednego `min_height`.** Iglica nie powstaje z „piętra
startowego”, tylko z **zagnieżdżonych footprintów**: każda część jest osobnym plastrem od gruntu do
swojej wysokości, a suma (unia) plastrów daje stożkowatą sylwetkę. Iglica to po prostu plaster
828 m o szerokości ~1 m.

To jest cała „magia”. Nie potrzebujesz do tego żadnego `min_height` — potrzebujesz **unii części**
i **braku przycinania małych części**.

---

## 3. Co robi nasz kod — pięć konkretnych miejsc

### 3.1 Relacja (outline) jest ekstrudowana RAZEM z częściami

`[my] gis_pipeline.py:138-163`: dla relacji z tagiem `building` tworzony jest rekord budynku z jej
obrysu — bez sprawdzenia, czy relacja ma członków `building:part`.
`[my] gis_pipeline.py:186-190`: części (`building:part`) są dodawane osobno.

Czyli dla Burj mamy **outline 148 m szerokości (h = 591 m) + wszystkie plastry**. Outline to ten
„przedłużony kwiat podstawy” — ogromny pryzmat o obrysie podstawy, wysoki na 591 m.
Wg Simple 3D Buildings: **jeśli są części, outline nie powinien być ekstrudowany**.

### 3.2 Brak unii / brak pojęcia „część jednego budynku”

`[my] mesh_builder.js:1000` — komentarz mówi o deduplikacji `building / building:part`, ale w całym
kodzie **nie ma użycia pola `part`** (grep: tylko ten komentarz) ani żadnego boolean union
(`grep union|csg|boolean` → 0 trafień w kodzie geometrii).

Efekt: każdy plaster to osobny, nachodzący na siebie pryzmat. Wizualnie w studiu potrafi to wyglądać
jak wieża, ale:
- ściany wewnętrzne zostają (podwójne, z-fighting — obejście `epsZ` `[my] :1079`),
- w slicerze to nakładające się wolumeny,
- nie ma jednej „bryły budynku”, do której można sensownie przyłożyć reguły wysokości.

### 3.3 Filtr „sliver” wywala iglicę i trzy najwyższe plastry

`[my] mesh_builder.js:950-952`:

```js
if (minSpan < 0.55 || area < 0.45) continue;
```

Przy naszym domyślnym kadrze ~1,2 km: 1 j. ≈ 7,06 m, więc próg to ~3,9 m szerokości i ~22 m²
powierzchni. Dla Burj:

| plaster | szerokość | pole | wynik |
| :--- | ---: | ---: | :--- |
| 828 m (iglica) | 1,1 m | 0,9 m² | **odrzucony** |
| 760 m | 3,9 m | 12 m² | **odrzucony** |
| 740 m | 4,0 m | 12,5 m² | **odrzucony** |
| 720 m | 3,8 m | 12 m² | **odrzucony** |

Czyli **cały szczyt 720–828 m znika**. Dokładnie to, co widać: brak iglicy.

### 3.4 „Anti-matchstick” obcina każdy plaster osobno

`[my] mesh_builder.js:1066-1070`:

```js
if (item.minSpan < 2.6) {
  const maxPrintableH = Math.max(1.8, item.minSpan * 2.85);
  if (totalHMm > maxPrintableH) totalHMm = maxPrintableH;
}
```

Próg 2,6 j. ≈ 18,3 m. Dla ocalałych plastrów Burj:

| plaster | szerokość | wysokość po naszym clampsie |
| :--- | ---: | ---: |
| 710 m | 15,0 m | **43 m** |
| 700 m | 9,1 m | **26 m** |
| 680 m | 10,4 m | **30 m** |
| 660 m | 7,7 m | **22 m** |
| 645 m | 13,7 m | **39 m** |
| 625 m | 10,1 m | **29 m** |
| 605 m | 13,1 m | **37 m** |
| 580 m | 14,8 m | **42 m** |
| 560 m | 17,5 m | **50 m** |
| 520 m | 16,3 m | **46 m** |
| 460 m | 19,7 m | **56 m** |
| **591 m (outline)** | **148,5 m** | **591 m (bez zmian)** |

Wynik: jedyna rzecz w pełnej wysokości to **pryzmat podstawy (148 m szerokości, 591 m)**,
a na nim kilkadziesiąt „zębów” 22–56 m. To jest dokładnie ten obraz, który opisujesz.

### 3.5 Wymyślone dachy = „trójkąty”

`[my] ui_gis_client.js:164-165` (ścieżka przeglądarkowa):

```js
roof: tags['roof:shape'] || 'hipped',
roofH: Math.min(6.5, Math.max(2.6, h * 0.22)),
```

`[my] gis_pipeline.py:476-489` robi to samo serwerowo: brak `roof:shape` → `hipped`, a wysokość
dachu minimum 2,8 m (do 7 m). Outline Burj **nie ma** `roof:shape`, więc dostaje **dach
czterospadowy 7 m** na szczycie 591 m — stąd „trójkąty” na czubku.

Do tego sam generator dachów `[my] mesh_extrude.js:110-160` (single-apex / chordal-spine) dokłada
facetki na każdym skosie; przy skomplikowanym obrysie wygląda to jak siatka trójkątów, a nie
czysty dach. Ich render ma **wszystkie dachy płaskie** — bo nie wymyślają dachów, których nie ma
w OSM.

### 3.6 `min_height` jest parsowany, ale nigdy nie użyty

- `[my] gis_pipeline.py:438-441` liczy `min_height` / `building:min_level`,
- `[my] gis_pipeline.py:499` zapisuje `minH` do rekordu,
- **nigdzie w `mesh_builder.js` / `mesh_extrude.js` nie ma `minH`** (grep: 0 trafień),
- ścieżka przeglądarkowa i tak hardkoduje `minH: 0` `[my] ui_gis_client.js:162`.

Dla Burj to nie ma znaczenia (tam nie ma `min_height`), ale dla wież, które **mają** `min_height`
(np. nadwieszone części), nasz model zawsze startuje od gruntu.

---

## 4. Co robią oni — mechanizm (na podstawie danych i outputu)

To nie jest zgadywanie „co bym poprawił”, tylko odtworzenie reguł, które muszą być spełnione, żeby
ich obraz był prawdziwy:

1. **Części zastępują outline.** Jeśli relacja/budynek ma `building:part`, obrys bazowy nie jest
   ekstrudowany. (Inaczej 148-metrowy pryzmat zasłoniłby wieżę — u nich go nie ma.)
2. **Każda część = plaster `[min_height ?? 0, height]`.** Dla Burj: 0→828, 0→760, …; zagnieżdżone
   footprinty dają stożek i iglicę.
3. **Unia per budynek.** Wszystkie plastry jednego `osmId`/relacji stają się jedną bryłą: brak
   wewnętrznych ścian, brak z-fightingu, brak nakładek w slicerze.
4. **Brak wymyślonych dachów.** Dach tylko wtedy, gdy jest `roof:shape` (+ `roof:height`);
   w przeciwnym razie płaski. Dlatego ich wieżowce są „równe”.
5. **Skalowanie wysokości na poziomie budynku, nie plastra.** Wysokość jest normalizowana tak, by
   cała wieża mieściła się w reliefie — nie obcina się pojedynczych, cienkich części.
6. **Stabilne ID budynków.** Ich konfigurator ma `markedBuildings`, `customBuildings`,
   `editedBuildings`, `deletedBuildings` (`mod 49391`), a marker jest wskazywany współrzędnymi
   (`tools/list` → `markers`). To wymaga, by budynek był **jednym obiektem**, a nie zbiorem
   przypadkowych trójkątów.

Czego nie wiem: jakiego dokładnie booleana używają (Blender/MeshLib/własny), czy robią remesh,
jaki jest ich limit wysokości. To nie zmienia powyższych reguł.

---

## 5. Co to znaczy „w kodzie”, bez zgadywania linii do poprawki

Kolejność, w jakiej problemy na siebie nachodzą (każdy z nich osobno psuje Burj):

```
OSM: relation outline + N parts
        │
        ├─ nasz pipeline: outline → budynek (591 m)  +  parts → budynki
        │                                               ↑ brak „parts zastępują outline”
        ▼
mesh_builder: dla każdego rekordu osobno
        ├─ filtr minSpan/area        → iglica + 720–760 m = precz
        ├─ clamp 2.85 × minSpan      → 605–710 m = 22–43 m
        ├─ zBase = teren            → każdy plaster od gruntu (minH ignorowane)
        └─ dach „hipped” domyślnie  → trójkąt na szczycie pryzmatu
        ▼
wynik: pryzmat podstawy 591 m + zęby + trójkątny daszek
```

Ich ścieżka to te same dane, ale z **grupowaniem po budynku i unią**, bez filtrów i bez
wymyślonych dachów.

---

## 6. Mosty i drogi (krótko, bo pytasz też o „mosty”)

Ich mosty wyglądają „równo”, bo pomost + filary + najazdy są **jednym zamkniętym solidem**
połączonym z jezdnią. U nas:

- drogi to osobne wstęgi: góra + 2 boki, **bez dna i bez zamknięć końców**
  (`[my] mesh_builder.js:1004-1006` — numeracja sprzed refaktoru; funkcja `pushQuad` w
  `mesh_extrude.js`, pętla dróg w `mesh_builder.js`),
- pomost mostu jest liczony od `bridgeDeckZ` (`[my] mesh_builder.js:968,998`), ale nie jest unią
  z terenem — stąd szczeliny i „wiszące” krawędzie,
- brak oznaczeń jezdni (u nich są modelowane jako cienkie wyspy koloru).

To ten sam problem co przy budynkach: **brak unii i domknięcia brył**, tylko w mniejszej skali.

---

## 7. Wnioski w jednym akapicie

Oni nie mają „lepszego renderera”. Mają **lepszy model danych**: `building:part` jako plastry,
outline pomijany, wszystko zunifikowane w jedną bryłę, dachy tylko z OSM. My mamy te same dane,
ale traktujemy każdy plaster jak osobny budynek, dodatkowo zaszywamy go filtrem
`minSpan < 0.55` i clampem `2.85 × minSpan`, a na końcu doklejamy wymyślony dach. Dlatego z Burj
zostaje podstawa z zębami i trójkątem.

Nie trzeba „poprawiać linii” — trzeba zmienić kontrakt: **jeden budynek = jedna unia plastrów**,
filtry/clampy na poziomie budynku (albo wcale), dach tylko gdy jest w OSM.

---

## 8. Zastrzeżenia

- Render ich Burj wygenerowałem przez publiczne MCP (26 cm, Dubaj); obraz jest w
  `$TMPDIR/lbq/burj_crop.png` (lokalnie, nie w repo).
- Nie mam dostępu do ich kodu geometrii — punkty z sekcji 4 to reguły wynikające z outputu i danych,
  nie cytaty z ich źródeł.
- Nasze numery linii dotyczą `b307cd6`; wcześniejsze notatki (`docs/analiza-lichtbild-vs-map3d.md`)
  mają numerację sprzed refaktoru i wymagają odświeżenia.
