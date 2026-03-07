# priced-in

A minimal Vue + Chart.js web app for exploring UK cost-of-living trends (1970 to present where available) priced in different denominators:

- fiat (£)
- gold (oz)
- average salary (fraction of annual pay)
- bitcoin (BTC)

## Run locally

Because this app uses CDN scripts, you can run it with any static file server:

```bash
python3 -m http.server 4173
```

Then open `http://localhost:4173`.


Bitcoin-denominated charts are intentionally limited to years where BTC reference data exists (early years render as gaps).
