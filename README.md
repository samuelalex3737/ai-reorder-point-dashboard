# Reorder Point Intelligence

AI-enhanced reorder point and inventory management dashboard for the MAIB "AI in Operations" course, Session II.

It covers two tasks:

1. **Exercise (main task):** enhance the reorder-point calculator and sensitivity analysis with
   - ML demand forecasting that retrains as new data arrives,
   - dynamic safety stock from the slide formula and a Monte Carlo simulation,
   - Bayesian optimisation of the reorder point and order quantity under constraints.
2. **Lab activity (Bullwhip Lab page):** a mini-simulation of the bullwhip effect, then a redesign of the network with AI forecasting and AI routing.

Everything runs in the browser (two Web Workers), is seeded, and updates live as controls change.

**Live dashboard:** https://ai-reorder-point-dashboard.vercel.app

## Run locally

Requires Node.js 20 or later.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 59 unit tests (formula fixture, leakage guard, Monte Carlo, simulator, GP/BO, CSV intake, bullwhip, allocation LP)
npm run build      # production build in dist/
npm run preview    # serve the production build
```

Offline scripts (only needed to regenerate the published files; they need the raw Kaggle CSV in `archive/`):

```bash
npm run prepare-data   # archive/retail_sales.csv -> public/data/skus.json and public/data/bullwhip.json
npm run train-lstm     # initial LSTM weights -> public/models/lstm-weights.json
npm run verify         # out-of-sample leaderboard per SKU
npx tsx scripts/verify-engine.ts     # policies, BO and tornado for every SKU and scenario
npx tsx scripts/verify-bullwhip.ts   # Bullwhip Lab runs, with and without shock and sharing
```

## Data

Talukdar, D. *Store Item Demand Forecasting Dataset*, Kaggle, MIT licence (synthetic daily sales, 50 stores x 50 items, 2019-2023).

- **Published:** only weekly totals for six store-item series:
  - the three dashboard SKUs (store_2/item_20, store_26/item_11, store_43/item_23);
  - the three Bullwhip Lab retailers (item_20 at store_2, store_9 and store_30).
- **Not published:** the raw 195 MB file stays out of git (`archive/` is ignored).
- **Licence notice:** MIT. Permission is granted, free of charge, to use, copy, modify, merge, publish and distribute the data, provided the copyright and permission notice are included. The data is provided "as is", without warranty of any kind.

## Architecture

- **Hosting:** a static Vite + React + TypeScript app on Vercel. There are no serverless functions. Vercel Hobby functions are capped at 300 s, 2 GB / 1 vCPU and 4 h of active CPU a month, which is too little to retrain models on every interaction.
- **Forecast worker:** runs 7 models with walk-forward out-of-sample evaluation (Naive, Seasonal Naive, Holt-Winters, Ridge, Random Forest, Gradient Boosting, LSTM on TensorFlow.js), picks the best model and derives sigma_D.
- **Optimisation worker:** runs the slide formula, the 20,000-draw Monte Carlo, the (s, Q) simulator with common random numbers, Bayesian optimisation (GP + Expected Improvement) against random search and grid sweeps, the tornado, and the Bullwhip Lab (multi-echelon simulation plus the min-cost allocation LP).
- **Precomputed:** the weekly aggregation and the LSTM's starting weights. The LSTM is fine-tuned in the browser whenever data arrives and can be retrained from scratch from the dashboard. Every other model refits live.

## Deploy to Vercel (GitHub import)

1. Push this folder to a personal GitHub repository. Hobby projects cannot import repos owned by a GitHub organisation.
2. In Vercel: **Add New... > Project > Import** the repository.
3. Settings are read from `vercel.json`:
   - framework Vite
   - build `npm run build`
   - output `dist`
   - install `npm install`
   - no environment variables
4. Click **Deploy**. Every push to `main` redeploys.

## 2-minute demo script for the professor

| Time | Do this | What updates |
|---|---|---|
| 0:00 | **Control Tower**, SKU A. Point at the KPI row and the "Baseline vs AI-enhanced" table. | Both baseline policies miss the 98% fill-rate target. The AI policies meet it, all on the same 200 simulated years. |
| 0:15 | Drag **Cycle service level** from 95% to 99%. | Reorder point, safety stock, dynamic ROP chart, comparison table and decision panel all recompute in about half a second. |
| 0:25 | In the decision panel, change **On hand** to a value below the reorder point. | Status switches to "Order now X units", with stockout probability and weeks of cover. |
| 0:35 | Click the **Supplier disruption** preset, then **Combined crisis**. | L and sigma_L rise. The slide-formula buffer jumps (lead-time risk dominates); baseline fill rates collapse while the AI policies hold the target. |
| 0:50 | **Demand Forecasting**: show the leaderboard (out-of-sample MAPE, WAPE, RMSE, Bias). Click **Stream 1 week**. | All 7 models retrain, the LSTM fine-tunes in the browser, and the version log adds v2 (WAPE, sigma_D, ROP). Optionally use CSV upload (validated) or manual entry. |
| 1:10 | **Safety Stock & Risk**: show the live formula breakdown, the Monte Carlo histogram (ROP marked, tail shaded) and SS vs service level. | The Monte Carlo ROP is above the formula ROP because lead times are right-skewed; the CSL vs fill-rate table explains the gap. |
| 1:25 | **AI Optimisation**: convergence chart and heatmap. Lower **Storage capacity**. | BO vs random search vs manual grid, same budget and seed. The infeasible (hatched) region grows and BO's chosen point moves. |
| 1:40 | **Bullwhip Lab**: walk through Steps 1-4. Click **Apply demand shock**, then toggle **Information sharing** off. | Baseline amplification at the manufacturer explodes, while AI forecasting with sharing stays low; turning sharing off brings it back. The network diagram shows AI routing moving Retailer 2 to its cheaper distributor. |
| 1:55 | **Methodology**: formulas, assumptions, what runs where, references. | |

## Project structure

```
src/lib/forecast/   features, metrics, 7 models, walk-forward pipeline
src/lib/inventory/  slide formula, Monte Carlo, (s, Q) simulator, decision logic
src/lib/optim/      Gaussian process, Bayesian optimisation, random and grid search
src/lib/engine/     controls, scenarios and the inventory engine that ties it together
src/lib/bullwhip/   multi-echelon simulation, allocation LP (min-cost flow), lab runs
src/lib/data/       catalogue, CSV intake and validation, browser persistence
src/workers/        forecast and optimisation Web Workers with request coalescing
src/pages/          Control Tower, Forecasting, Risk, Optimisation, Bullwhip Lab, Methodology
tests/              Vitest unit tests
scripts/            offline data prep, LSTM training and verification
docs/               implementation plan with the traceability table
```
