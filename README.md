# priced-in

A minimal Vue + Chart.js web app for exploring UK cost-of-living trends priced in different denominators:

- fiat (£)
- gold (oz)
- average salary (fraction of annual pay)
- bitcoin (BTC)

The chart data is served by a Vercel serverless API endpoint (`/api/prices`) that reads from `prices-api.json`, so data can be managed separately from app logic and each series can include source citations.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import the project in Vercel.
3. Deploy with defaults (no build command required).

Vercel will serve static files from the repository root and expose the serverless function in `api/prices.js` automatically.


## Live denominator data

The `/api/prices` endpoint now refreshes **gold** and **bitcoin** denominator series from Yahoo Finance on each request:

- Gold: `XAUGBP=X`
- Bitcoin: `BTC-GBP`

Data is fetched at **monthly** resolution and then averaged into annual values so the existing yearly chart model remains compatible.

## Local development (optional)

To mirror Vercel behavior locally:

```bash
npx vercel dev
```

## Data policy

- Charts plot only explicit yearly values from `prices-api.json` (the app does not interpolate).
- The dataset now spans 1952-2025:
  - `house` has continuous annual coverage using a blended method: historical anchors (1950s onward) + modern UK HPI annual averages, with interpolation performed in the data preparation step.
  - Most non-house items and denominator series retain dense annual coverage from 2010 onward, and are `null` for earlier years where compatible historical series were not yet added.
- 2025 entries are flagged as provisional in `prices-api.json` methodology notes.
