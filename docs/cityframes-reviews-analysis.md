# Cityframes 374 Reviews Competitive Analysis

This report analyzes all 374 public Judge.me reviews for Cityframes (`cityframes.de`).
We collected all 374 unique reviews from `2022-01-09` through `2026-11-11`.
Raw datasets live in `research/cityframes_reviews_374.json` and `research/cityframes_reviews_374.csv`.

## 1. Core Metrics

| Metric | Value | Notes |
| :--- | :---: | :--- |
| Total unique reviews | `374` | `373` verified buyers, `100%` product reviews, `100%` contain text |
| Average rating | `4.77 / 5.00` | `5*`: 326 (87.2%), `4*`: 24 (6.4%), `3*`: 14 (3.7%), `2*`: 6 (1.6%), `1*`: 4 (1.1%) |
| Coupon-incentivized reviews | `295` (`78.9%`) | Badge `review_earned_for_future_purchase`, avg `4.79*`, `5.8%` `<=3*` |
| Unincentivized Shop App reviews | `54` (`14.4%`) | Avg drops to `4.65*`, `<=3*` rate nearly doubles to `11.1%` |
| Store replies | `2 / 374` (`0.5%`) | Store ignores public review engagement |
| Customer review photos | `1 / 374` (`0.3%`) | Store disabled review photo uploads in Judge.me |
| Peak month (December) | `96 / 374` (`25.7%`) | December plus January drive `36.1%` of annual volume |

### Rating Breakdown by Product Category

| Product Category | Count | Avg Rating | `<=3*` Count | `<=3*` Rate |
| :--- | :---: | :---: | :---: | :---: |
| Engraved Plaque | `7` | `5.00` | `0` | `0.0%` |
| Bundle / Trio | `21` | `4.95` | `0` | `0.0%` |
| Wall FRAME / Wide | `26` | `4.92` | `0` | `0.0%` |
| CUBE | `126` | `4.82` | `7` | `5.6%` |
| Display Cover (Acrylic/Glass) | `31` | `4.77` | `2` | `6.5%` |
| Named Single City (Legacy) | `39` | `4.74` | `2` | `5.1%` |
| miniCUBE | `118` | `4.69` | `12` | `10.2%` |
| GRAND / BLOK (Large/Table) | `4` | `3.75` | `1` | `25.0%` |

`miniCUBE` generates half of all `1-3*` complaints (`12` of `24`).
Wall frames and multi-city bundles hold `0%` `<=3*` complaints and average `4.92-4.95*`.

### Markets and Yearly Volume

- **Top buyer countries** (`274` tagged reviews): US (`46`), DE (`36`), GB (`34`), IT (`22`), ES (`18`), FR (`12`), NL (`12`), CA (`11`), CH (`11`), AE (`10`), MX (`9`), PT (`8`), AU (`7`).
- **Yearly review trend**: 2022 (`19`), 2023 (`31`), 2024 (`119`), 2025 (`140`, Dec peak `36`), 2026 (`65`).
- Volume dropped sharply after April 2026 (`8` reviews total from May through November 2026).

## 2. Primary Value Drivers and Retention Engine

### Collector Flywheel

Buyers rarely stop at one city.
Repeat collectors report owning `3`, `5`, `7`, `12`, `15`, and up to `30` frames.
Couples replace tacky travel souvenirs with a growing architectural wall of visited cities.
Post-purchase review coupons (`78.9%` of reviews) directly accelerate second and third orders.

### Gift-to-Self Viral Loop

Gifts drive both new acquisitions and organic repeat sales.
Gift recipients return to buy more cities for themselves.
Gift buyers order additional frames for their own homes after unboxing.
Displayed frames trigger guest conversations and direct website referrals in homes and client offices.

### Verified Buyer Personas

1. **Travelers and couples**: Build a growing wall of visited cities instead of tourist souvenirs.
2. **Architects and urbanists**: Show highest lifetime value (`10-15+` models) and prize minimalist white-on-black contrast.
3. **Gift buyers**: Target Q4 holidays, birthdays, anniversaries, weddings, and farewell gifts.
4. **Expats and nostalgia buyers**: Commemorate hometowns, former workplaces, study cities, or hotels from trips.
5. **B2B offices and real estate firms**: Display large local skyline models in client meeting rooms.

### High-Converting Offer and Packaging Wins

- **Buy-3 bundle deals**: Overcome hesitation on social ads ("2 for myself and 1 as a gift").
- **Magnetic detachable hero spires**: Cityframes ships the tallest building flat separately with a magnet on newer CUBE and GRAND units to prevent transit breakage.

## 3. Seven Competitor Weaknesses (`48` Reviews Rated `<=4*`)

| Weakness Theme | Hits in `<=4*` | Share of `48` | Core Buyer Evidence |
| :--- | :---: | :---: | :--- |
| 1. Print quality or detail below video hype | `17` | `35.4%` | Buyers cite cheap look vs video, poor 3D print finish, flat Milan skyscrapers, weak definition |
| 2. Scale shock ("smaller than expected") | `12` | `25.0%` | Ads show large models while buyers receive tiny `miniCUBE`; buyers demand real-life scale in ads |
| 3. Missing or loose acrylic display cover | `10` | `20.8%` | Buyers expect glass included from ads; cover sits loosely without a groove and knocks tall towers |
| 4. Price friction and surprise tariffs | `8` | `16.7%` | A loyal 5-order US buyer quit after an unannounced `$34` door tariff (>50% of product price) |
| 5. Fixed city crop misses iconic landmarks | `6` | `12.5%` | Buyers report wrong NYC, Barcelona, and Lisbon crops plus missing cities (Brighton, Milan, Buenos Aires) |
| 6. Fragile towers snap in transit or handling | `5` | `10.4%` | Thin spires break on arrival or light touch; one GRAND unit arrived with 3 broken towers |
| 7. Missing city label, zoom, tile gaps, wall alignment | `4+` | `8.3%+` | Buyers report no website zoom, visible gaps between 9 tiles, hard multi-cube wall alignment, and missing city names |

## 4. Action Plan for `map-to-3dprint`

### Validated Decisions (Keep Strict)

1. **Mandatory hand-scale reveal in ads**: Keep the `11-15 s` hand reveal and real-scale desk props from `docs/product-and-ads-decisions.md` to eliminate scale shock.
2. **Seamless resin joint finishing**: Keep liquid-resin seam filling, UV cure, and matte clear coat across two-tile `13 x 18 cm` prints so zero tile gaps appear.
3. **Single-frame wall sets (`3x1` and `2x2`)**: Promote one-frame multi-city sets to remove multi-frame wall-alignment frustration.
4. **10K MSLA precision and LoD2 roofs**: Highlight crisp resin micro-architecture and accurate tower heights against coarser print finishes.

### High-Priority Product and Marketing Upgrades

1. **Lead ads with custom framing and live 3D zoom (`P0`)**: Position our WebGL configurator as the cure for rigid catalogs. Let buyers frame their exact street, office, or landmark and inspect every roof in 3D before ordering.
2. **Protect tall spires (`P0`)**: Print with tough or ABS-like matte resin blends. Use a flat-packed magnetic detachable spire for ultra-slender landmarks during shipping.
3. **Offer an optional stick-on engraved plaque (`P0`)**: Keep default hero visuals clean and nameplate-free. Sell an optional unattached city plaque (`+29-39 PLN`) so minimalists keep pure art and gift buyers add clear city labels.
4. **Engineer a recessed groove if adding an acrylic cover (`P1`)**: Never imply glass inclusion in ads unless bundled. If we add a dust cover upsell, mill a recessed perimeter slot in the bezel so the cover locks cleanly.
5. **Launch a 3-single-frame bundle and collector flywheel (`P1`)**: Add a `3 x 13 x 18 cm` bundle ("2 for yourself + 1 gift") alongside `3x1` and `2x2` wall sets. Lock frame finish consistency across years, include a `-15%` next-city collector card, enable review photos, and reply to every review.
6. **Ship a 1:1 paper mounting template (`P1`)**: Include a cheap paper drilling template with multi-frame orders to make wall hanging effortless.
7. **Eliminate delivery and tariff surprises (`P2`)**: Show exact estimated delivery dates on product pages during Q4 and use tax-included DDP checkout for international buyers.
