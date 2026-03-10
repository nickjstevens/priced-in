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

## Local development (optional)

To mirror Vercel behavior locally:

```bash
npx vercel dev
```

## Data policy

- Charts plot only explicit yearly source values in `prices-api.json` (no interpolation in app code).
- The current dataset is annual for 2010-2024 across all series to preserve like-for-like year-over-year comparisons.
