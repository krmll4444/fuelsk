# Уніфіковані типи пального (SK)

Мета: однакова шкала в UI і в `stations.json`, незалежно від маркетингової назви мережі.

## Первинні типи

| Ключ | Українською | Що це |
|---|---|---|
| `natural95` | 95 звичайний | Базовий бензин ~95 (E5), без «преміум»-присадок |
| `natural95_plus` | 95 з присадками | Aditivovaný / MaxxMotion 95 / 95+ |
| `natural98` | 98 | Natural 98 / частина Shell V-Power як 98 |
| `natural100` | 100 / 99+ | ~99–100 октан (Racing, Vermila, Natural99+) |
| `diesel` | Дизель | Звичайна нафта |
| `diesel_plus` | Дизель з присадками | Diesel+, MaxxMotion Diesel, V-Power Diesel |

Додаткові (не в основному селекторі): `lpg`, `cng`, `adblue`.

## benzin.sk → ключ

| Код | Назва на сайті | Ключ |
|---|---|---|
| 2 | Natural95 | `natural95` |
| 32 | Normal95 (UNI) | `natural95` |
| 4096 | Natural95+ | `natural95_plus` |
| 4 | Natural98 | `natural98` |
| 128 | Natural99+ | `natural100` |
| 8 | Diesel | `diesel` |
| 256 | Diesel+ | `diesel_plus` |

## Мережі (маркетинг → ключ)

Код: [`engine/sources/fuel_taxonomy.mjs`](../engine/sources/fuel_taxonomy.mjs) (`BRAND_PRODUCTS`, `NAME_RULES`).

- **Slovnaft**: Efecta 95 → 95; Efecta Diesel → дизель; Vermila/Racing 100 → 100
- **OMV**: базовий 95/Diesel; MaxxMotion 95/Diesel/100 → plus / 100
- **Shell**: FuelSave → звичайний; V-Power → plus / 100 (Racing)
- **MOL**: EVO → звичайний; Dynamic → plus
- **Orlen**: EFFECT → звичайний; premium/VORTEX → plus

Якщо з джерела приходить лише «95 Natural+» (як у benzin.sk title) — правило `NAME_RULES` також зводить до `natural95_plus`.
