# Fuel SK

Ціни на пальне в Словаччині: cron → JSON → **PWA** (+ пізніше віджет Scriptable).
Зараз: engine (benzin.sk) + геокодинг + PWA-карта.

## Вимоги

- Node.js 20+

## Engine

```bash
cd engine
npm install
npm test
npm run dry-run                          # фікстури → data/stations.dry-run.json
node index.mjs                           # усі міста з налаштувань PWA + OSM SK
node index.mjs --cities kosice,zilina    # підмножина
node index.mjs --region KE --town Košice # один край (legacy)
```

Корисні прапорці: `--limit N`, `--skip-geocode`, `--skip-osm`.

### Що відомо про benzin.sk

- Відповіді й query в **windows-1250**.
- Порожній `price_search_town` + край KE працює.
- Ціни в HTML — **PNG**; engine робить OCR табла.
- Координат на сайті немає → Photon (fallback Nominatim), кеш у `data/geocache.json`.

## PWA (локально)

```bash
# після збору даних:
cd pwa
python3 -m http.server 8791
# відкрити http://127.0.0.1:8791/
```

На iPhone (після деплою на GitHub Pages, HTTPS): Safari → Поділитися → На початковий екран.

Функції v1: карта з цінами (не старше 3 днів), усі заправки з OSM (пін без ціни), фільтри (пальне, бренд, радіус, відкриті), список, картка станції, Apple/Google Maps, PWA.

## GitHub Actions — автооновлення даних

Workflow [`.github/workflows/collect.yml`](.github/workflows/collect.yml):

- **cron** раз на добу о 05:15 UTC (~07:15 за Братиславою взимку)
- **Run workflow** вручну (можна обмежити міста / `--limit`)
- після збору комітить `data/` + `pwa/data/` → `pages.yml` передеплоїть PWA

Налаштування (опційно): Settings → Secrets and variables → Actions

| Name | Тип | Призначення |
|------|-----|-------------|
| `CITIES` | Variable | `all` або `kosice,zilina,…` |
| `DAY_WINDOW` | Variable | вікно свіжості на benzin.sk (default 14) |
| `REQUEST_DELAY_MS` | Variable | пауза між запитами (default 2000) |
| `USER_AGENT` | Variable | ідентифікація кроулера |
| `NOMINATIM_EMAIL` | Secret/Variable | контакт для Nominatim fallback |

Потрібні права: workflow вже має `contents: write`. Якщо `main` захищений — дозвольте github-actions пушити, або зніміть branch protection для бота.

Повний збір 12 міст може тривати **1–2+ години** (таймаут job = 180 хв).

## GitHub Pages

Workflow [`.github/workflows/pages.yml`](.github/workflows/pages.yml) викладає `pwa/` + `data/*.json`.
У репозиторії: Settings → Pages → Source = GitHub Actions.

## Етика збору

- Раз на добу (або рідше), `REQUEST_DELAY_MS` ≥ 1000–2000, зрозумілий `USER_AGENT`.
- Не молотити всі міста без паузи.

## Структура

```
engine/     збирач + OCR + geocode
data/       stations.json, geocache.json
pwa/        карта (Leaflet), manifest, SW
.ini.md     повна специфікація
```

Далі: віджет Scriptable, маршрут з економією (OSRM), усі краї.

## Уніфікація пального / лейбли / графік

- Таксономія: [`docs/fuel-taxonomy.md`](docs/fuel-taxonomy.md) (`95`, `95+`, `98`, `100`, `дизель`, `дизель+`)
- Джерела: [`docs/sources.md`](docs/sources.md)
- Мережева однакова ціна → лейбл «Ціна мережі» + `data/networks.json`
- Вигідні для вибраного пального → «Найвигідніша» / «Нижче середньої»
- Графік з benzin.sk → відкрито/закрито зараз (Europe/Bratislava), фільтр «Лише відкриті»
