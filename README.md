# priced-in

Vue + Chart.js app for exploring UK cost-of-living series in multiple denominators.

## Features

- Per-item cards and a **comparison mode** (multiple items on one chart)
- Denominator switching: nominal GBP, real GBP (CPI-adjusted), gold, average salary, median salary, hours worked, bitcoin
- Rebased/indexed mode (start of selected range = 100)
- Global date ranges and shareable deep links via URL params
- Bitcoin-specific UX for sparse early history + full-history toggle
- CAGR/total-change stats and lightweight insight text
- Category filter + search
- CSV export for current view
- Source quality badges, dates, notes, lineage, and item measurement metadata
- Optional observed-only view to reduce interpolation ambiguity
- Optional macro event annotation overlays (financial crisis, Brexit, COVID, inflation, BTC cycles)
- Rolling 5-year volatility of log returns on each item card
- Relative price ratio chart (A/B), 2-year forecast bands, and compare-mode rolling correlation/regime hints
- Assumptions & caveats page

## Run locally

```bash
npx vercel dev
```

## Validate data

```bash
node tests/validate-data.js
```
