# priced-in

A minimal Vue + Chart.js web app for exploring UK cost-of-living trends priced in different denominators:

- fiat (£)
- gold (oz)
- average salary (fraction of annual pay)
- bitcoin (BTC)

The chart data now loads from a local API-style JSON endpoint (`prices-api.json`) so data can be managed separately from app logic and each series can include source citations.

## Run locally

Because this app uses CDN scripts, you can run it with any static file server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.
