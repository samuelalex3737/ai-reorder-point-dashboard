# Phase 2 - Dataset Inspection and Implementation Plan

AI Reorder Point and Inventory Intelligence Dashboard
Session II: AI Applications in Reorder Point and Inventory Management - Exercise

Status: approved and implemented (Parts 1-6). The traceability tables below map every requirement to the feature that delivers it.

---

## 1. Dataset inspection

**Source:** Talukdar, D. (2026) *Store Item Demand Forecasting Dataset*, Kaggle, MIT licence.
**File:** `archive/retail_sales.csv` (195.2 MB). This file stays out of git and out of the deployment.

### 1.1 Structure

| Property | Finding |
|---|---|
| Columns | `date, store_id, item_id, sales, price, promo, weekday, month` |
| Rows | 4,565,000 (50 stores x 50 items x 1,826 days) |
| Date range | 2019-01-01 to 2023-12-31, daily, every series complete |
| Series | 2,500 store-item series, 1,826 rows each |
| Sales | Integer units, 0 to 139 per day |
| Price | Constant base price per series. Promotion days are exactly 20% off (19.9% to 20.1%) |
| Promo | Binary. 10.0% of days. 81% of promotions last 1 day, 99% last 1-2 days |
| weekday / month | Consistent with `date` on every row (weekday 0 = Monday) |

### 1.2 Quality and gaps

| Check | Result | Action |
|---|---|---|
| Blank or unparseable cells | 0 | none |
| Duplicate or out-of-order rows | 0 | none |
| Gaps in any series | 0 | none |
| Negative sales | 0 | none |
| Zero-sales days | 1,037 (0.02%) | keep, they are genuine low draws |
| Partial first week | 2019-01-01 is a Tuesday | drop 2019-01-01 to 2019-01-06; use 260 full Monday-Sunday weeks (2019-01-07 to 2023-12-31) |
| Holiday effects | Chain-wide sales on Christmas, New Year, Black Friday and 4 July are within 2% of the same weekday in neighbouring weeks | no holiday feature from the data (it would add noise). The upload accepts optional `holiday` / `temperature` columns |
| Weather | not present | documented as a limitation; optional upload column |
| Lead times | not present | modelled as gamma(mean L, sd sigma_L), see section 4 |

Cleaning needed: weekly aggregation and dropping the partial first week. Nothing else.

### 1.3 Demand structure (weekly, all 2,500 series)

| Statistic | Median (p10 - p90) | Meaning |
|---|---|---|
| Weekly mean demand | 204 (99 - 313) units | volume differs about 6x across series |
| Weekly CV | 0.23 (0.22 - 0.24) | similar relative volatility everywhere |
| Yearly seasonality (peak/trough month ratio) | 1.79 (1.75 - 1.84) | peak in March-April, trough in September-October |
| Trend (2023 vs 2019) | +23% (+21% - +26%) | steady growth |
| Day-of-week ratio | 1.48 | absorbed by weekly aggregation |
| Promotion uplift (promo day vs normal day) | +50% (+46% - +54%) | strong, learnable driver |
| Autocorrelation lag 1 / lag 52 (weekly) | 0.90 / 0.90 | lags and seasonality are highly informative |

**Honest note:** the data is synthetic and very regular. Every series has the same shape at a different scale (store x item multiplicative effects: store means 24-36 units/day, item means 12-47 units/day). Expect ML models to beat naive baselines clearly, and expect small errors relative to real retail data. The Methodology page will say this.

### 1.4 The 3 representative SKUs

Chosen to span the volume tiers an operations manager plans differently for (fast, typical, slow mover). Because all series share one shape, volume and relative noise are what actually differ.

| SKU label | Series | Weekly mean | Weekly sd | Short-term noise (sd around 5-week trend) | Promo share | Promo uplift | Growth 2019-23 | Season ratio | Why |
|---|---|---|---|---|---|---|---|---|---|
| A - Fast mover | store_2 / item_20 | 396.9 | 85.9 | 21.6 (5.4%) | 11.8% | +45% | +23% | 1.78 | highest-volume series in the dataset, highest promo exposure among the top movers |
| B - Typical | store_26 / item_11 | 203.5 | 45.5 | 12.9 (6.3%) | 9.6% | +51% | +22% | 1.77 | the dataset median on every statistic |
| C - Slow mover | store_43 / item_23 | 69.9 | 18.0 | 8.0 (11.4%) | 11.1% | +47% | +26% | 1.92 | slow mover with twice the relative noise and the strongest seasonality, so it needs the largest relative buffer |

Per-SKU policy parameters (defaults, all editable live) reuse the professor's notebook values so the baseline is comparable:

| SKU | L (weeks) | sigma_L (weeks) | h holding (per unit-week) | p stockout (per unit) | K ordering (per order) | Capacity (units) |
|---|---|---|---|---|---|---|
| A | 2.0 | 0.5 | 1.1 | 15 | 1,500 | 4,000 |
| B | 3.0 | 0.8 | 1.3 | 18 | 2,000 | 3,000 |
| C | 4.0 | 1.2 | 1.8 | 25 | 1,200 | 1,500 |

L and h come from the professor's notebook (Products A/B/C). sigma_L, p and K come from `engine.py`. Capacity is scaled to each SKU's volume. All are stated as assumptions on the Methodology page.

**Time unit everywhere: weeks.** D-bar, sigma_D, L and sigma_L are all in weeks / units per week. The professor's day-based ROP sweep is reproduced in its original day units, clearly labelled.

---

## 2. System architecture and the Vercel constraint

### 2.1 Vercel Hobby limits (from Vercel docs, checked 2026-11-11)

| Limit | Hobby value |
|---|---|
| Function max duration | 300 s (default and maximum) |
| Function memory / CPU | 2 GB / 1 vCPU |
| Function bundle size | 250 MB uncompressed |
| Request / response body | 4.5 MB |
| Build time per deployment | 45 min |
| Monthly allotment | 100 GB Fast Data Transfer, 1,000,000 function invocations, 4 h Active CPU, 360 GB-hrs provisioned memory |
| Deployments | 100 per day |
| Other | non-commercial personal use only; Hobby projects cannot connect to repos owned by a GitHub organisation (use a personal repo) |

### 2.2 Decision: a static single-page app, with all computation in the browser

The deployment is a static Vite + React build served from Vercel's CDN. **No serverless functions.** Every computation runs in the viewer's browser in Web Workers.

| Computation | Where it runs | Why |
|---|---|---|
| Data prep (195 MB CSV to 3 weekly series) | Offline, once, Node script `scripts/prepare-data.ts` | The raw file is too big for git (GitHub 100 MB file limit) and must not be published. The output is about 30 KB of JSON |
| Naive, Seasonal Naive, Holt-Winters, Ridge, Random Forest, Gradient Boosting | Browser, forecast worker, retrained on every data change | Each fits in milliseconds on about 260 rows. Retraining live is what makes "continuously update" real |
| LSTM | **Initial weights trained offline** (Node + TensorFlow.js, seeded, same code as the browser) and shipped as about 20 KB of weights. **Fine-tuned in the browser** (warm start, a few epochs) whenever data arrives. A "Full retrain" button retrains from scratch in the worker | Training from scratch takes several seconds, too slow for first paint. Fine-tuning keeps the live path genuinely retraining |
| Monte Carlo (20,000 draws) | Browser, optimisation worker | under 50 ms per run |
| (s, Q) inventory simulator, Bayesian optimisation, random search, grid sweep, tornado | Browser, optimisation worker | about 600 simulator calls per full refresh at about 2 ms each |
| Persistence (added data, version log) | Browser IndexedDB | no server, so uploaded data never leaves the device |

Why not serverless functions: Hobby gives 4 hours of Active CPU per month and a 300 s cap. Retraining on every slider move or upload would burn through that, add network latency to every control, and send uploaded data to a server. The browser already has the data, the CPU, and zero latency.

**Precomputed parts (stated in the UI and the Methodology page):** (1) the weekly aggregation of the Kaggle file, and (2) the LSTM's starting weights. Everything else is computed live.

### 2.3 Data flow

```
archive/retail_sales.csv --(prepare-data, offline)--> public/data/skus.json (3 SKUs, 260 weeks)
                                                       public/models/lstm-*.json (initial weights)
Browser
  UI (React) --params--> optimisation worker: SS formula, Monte Carlo, simulator, BO, random, grid, tornado
     |                          ^ forecast path, sigma_D
     +--data events--> forecast worker: features, 6 models + LSTM, walk-forward evaluation, best model, forecast
  IndexedDB: appended rows + model version log
```

Workers return results tagged with a job id, and stale results are dropped. Slider changes are debounced by 150 ms, so the UI never blocks.

---

## 3. Forecasting design (Step 1)

**Target:** weekly units per SKU.

**Features (past data only, built with shifts):**
- lag 1, 2, 3, 4 and 52
- rolling mean and sd over the last 4 weeks (shifted by 1 week)
- week-of-year sin and cos
- trend index
- promo days in the week (0-7) and average price index. These are known in advance because promotions are planned.
- any optional uploaded numeric column, such as holiday or temperature

**Models compared (at least the 5 required, plus 2):**

| Model | Type | Notes |
|---|---|---|
| Naive (last week) | baseline | the professor's baseline |
| Seasonal Naive (52 weeks) | time-series baseline | |
| Holt-Winters additive (52-week season) | classical time series | parameters chosen by one-step SSE on the training split |
| Ridge regression | regression | closed form, standardised features |
| Random Forest | tree ensemble | the professor's model, now evaluated out of sample |
| Gradient Boosted Trees | tree ensemble | depth 3, shrinkage 0.05 |
| LSTM | deep learning | 12-week window, 1 layer with 16 units plus a dense layer, Adam, seed 42 |

**Evaluation (out-of-sample only):** chronological split. The last 52 weeks of available history are the test set, with one-step-ahead walk-forward: each test week is predicted from features built only from earlier actual weeks. Models are fitted on the training split only. Metrics: MAPE, WAPE, RMSE and Bias. The leaderboard ranks by WAPE. A unit test asserts that no feature row uses a value at or after its own target week (a leakage guard).

**Linking forecasting to safety stock:**
- sigma_D = sd of the best model's out-of-sample one-step errors (weekly units)
- D-bar = mean of the forecast over the lead-time window, ceil(L) weeks ahead
- The forecast path drives the dynamic ROP and the simulator

**Adding new data:**
1. **CSV upload** with validation. It accepts Kaggle-style daily rows (`date, store_id, item_id, sales, price, promo`), which are aggregated to weeks, or weekly rows (`week_start, sku, demand, promo_days, price, [extra numeric columns]`). Checks: required columns, numeric types, no negatives, dates in sequence with no duplicates or overlap with existing weeks, outliers more than 5 MAD from the median flagged as warnings. A row-level error report is shown, and nothing is applied until the file is valid.
2. **Manual entry** of the next week: demand, promo days and price, with the same validation.
3. **"Stream next period":** the app initially holds back the final 26 real weeks of 2023 (Jul-Dec) and reveals them one per click, so the "live feed" is real data. After those run out, it generates weeks from the best model plus bootstrapped residuals (seeded), labelled "simulated".

Each arrival triggers: retrain all models, fine-tune the LSTM, re-evaluate, re-select the best model, then recompute sigma_D, SS, Monte Carlo, ROP and BO. Each arrival also adds a row to the **model version log** (version, timestamp, rows, best model, WAPE, sigma_D, ROP, delta vs previous version), stored in IndexedDB. A "Reset to dataset" button restores the original state.

---

## 4. Safety stock and Monte Carlo design (Step 2)

- **Slide formula, exactly:** `SS = Z * sqrt(sigma_D^2 * L + Dbar^2 * sigma_L^2)` and `ROP = Dbar * L + SS`. Unit test: Z 1.6449, sigma_D 28, L 2, Dbar 572, sigma_L 0.5 gives SS 474.9 and ROP 1,618.9.
- **Professor baseline:** `SS = Z * sigma * sqrt(L)`, with sigma = sd of raw weekly demand. Unit test: sigma 65, L 2 gives 151.2. Fixed-SS baseline: `ROP = d * L + 200`.
- **Z** from an inverse normal CDF (Acklam / Wichura AS241 rational approximation, tested against known quantiles).
- **Monte Carlo:**
  - 20,000 seeded draws (xoshiro128** PRNG)
  - lead time from a gamma distribution with shape (L/sigma_L)^2 and scale sigma_L^2 / L (mean L, sd sigma_L, positive and right-skewed), sampled with Marsaglia-Tsang
  - demand during lead time, conditional on the drawn lead time: Normal(Dbar * lt, sigma_D * sqrt(lt)), truncated at 0
  - ROP_MC = the service-level quantile of that distribution; SS_MC = ROP_MC - Dbar * L
- **Service-level definitions:**
  - Z and ROP_MC target the **cycle service level** (probability of no stockout in a replenishment cycle).
  - The simulator measures the **fill rate** (share of demand met from stock).
  - Both are reported for every policy, along with the analytic fill rate implied by the CSL (expected units short per cycle divided by Q).
  - The page explains in plain language why a 95% CSL usually gives a fill rate above 95%.
- **Scenarios / risk:** five presets adjust the forecast multiplier, sigma_D, L, sigma_L and planned promotions, and the Monte Carlo reruns.

**Inventory simulator** (shared by every policy, common random numbers):
- weekly periodic review, (s, Q) policy, backorders allowed, stochastic gamma lead times rounded to whole weeks (minimum 1)
- 52 simulated weeks after an 8-week warm-up, 200 replications
- the demand mean follows the forecast path (seasonal), with Normal(0, sigma_D) noise
- one seeded draw matrix (demand and lead times) is generated per parameter set and reused for every policy
- outputs: annual holding, stockout and ordering cost; fill rate; achieved CSL (share of cycles without a stockout); weekly stockout probability; average on-hand; orders per year
- one replication is also traced for the inventory-level chart

---

## 5. Bayesian optimisation design (Step 3)

- **Decision variables:** reorder point s and order quantity Q. Bounds: s in [0.6 * Dbar * L, Dbar * L + 4 * SS-scale], Q in [0.3 * EOQ, 3 * EOQ].
- **Objective:** expected annual holding + stockout + ordering cost from the simulator above, using common random numbers.
- **Constraints as penalties:**
  - fill rate >= target (default 95%): penalty 4e5 * shortfall
  - s + Q <= storage capacity: penalty 50 per unit over
  - optional budget, average inventory value <= budget: proportional penalty
- **Surrogate:**
  - Gaussian process with a Matern 5/2 ARD kernel on inputs normalised to [0,1]^2, standardised outputs, plus a noise term
  - hyperparameters chosen by maximising the log marginal likelihood over a log-spaced grid, then a few coordinate refinements
  - Cholesky solves written in TypeScript (2-D problem, at most 40 points)
- **Acquisition:** Expected Improvement, maximised over 2,048 seeded quasi-random candidates plus local refinement around the best 5.
- **Budget and seeds:** 10 Latin-hypercube initial points + 30 EI iterations = 40 evaluations.
- **Comparisons:**
  - random search with 40 evaluations and the same seed
  - a budget-matched manual grid (7 x 6 = 42 evaluations)
  - a full 20 x 20 grid (400 evaluations) as ground truth, which also feeds the heatmap
- **Outputs:** convergence curves (best feasible cost vs evaluation number), the optimum (s*, Q*), the gap to the full-grid optimum, and the GP posterior mean surface.
- **Tornado (sensitivity of the reorder point):** +/-20% on Dbar, sigma_D, L, sigma_L, h and p.
  - The formula ROP responds to Dbar, sigma_D, L and sigma_L.
  - The cost-optimal s (1-D golden-section search on the simulator at Q*, common random numbers) responds to all six. h and p only change the cost-optimal ROP, which is the point of optimising instead of using a formula.

**Baseline vs AI-enhanced comparison:** every policy below is evaluated on the same simulator with the same draws.

| Policy | s | Q |
|---|---|---|
| Professor fixed SS | Dbar_hist * L + 200 | EOQ |
| Professor static SS | Dbar_hist * L + Z * sigma_raw * sqrt(L) | EOQ |
| AI dynamic SS (slide formula, forecast-driven) | weekly s_t = forecast over the LT window + SS_t | EOQ |
| AI Monte Carlo ROP | ROP_MC | EOQ |
| AI Bayesian-optimised | s* | Q* |

Columns: annual cost (split into holding, stockout and ordering), fill rate, achieved CSL, stockout probability, average on-hand, and "target met" (yes/no).

---

## 6. Dashboard pages and visuals

Global left rail (a drawer on mobile):
- SKU selector (A / B / C)
- scenario presets: Normal, Demand surge, Supplier disruption, Promotion period, Combined crisis
- controls: service level (80-99.5%), L, sigma_L, h, p, K, target fill rate, storage capacity, optional budget toggle and value

A status chip shows worker activity, and a "Data version vN" chip shows the current version.

| Page | Visuals and panels |
|---|---|
| **1. Control Tower** | KPI tiles (current ROP, SS, sigma_D, best model + WAPE, stockout probability, annual cost); **Decision panel** (on-hand, on-order, backorders inputs giving "Order now X units", "Watch" or "Healthy", plus stockout probability and weeks of cover); **Baseline vs AI-enhanced** comparison table and cost bar chart; **dynamic ROP over the 26-week forecast horizon vs the flat baseline ROP** |
| **2. Demand Forecasting** | forecast vs actual with an 80/95% uncertainty band (history, test window and 26-week forecast); **model leaderboard** (MAPE, WAPE, RMSE, Bias, sortable); per-model test-window overlay; data intake (CSV upload, manual entry, "Stream next period"); **model version log** table and a WAPE / sigma_D / ROP trend chart across versions |
| **3. Safety Stock and Risk** | **Monte Carlo demand-during-lead-time histogram** with the ROP marked and the stockout tail shaded; lead-time distribution inset; **SS vs service level 80-99%** for baseline, slide formula and Monte Carlo; CSL vs fill-rate explainer; **inventory-level simulation** (on-hand and inventory position vs the ROP line, with order placements and arrivals marked) |
| **4. AI Optimisation** | **BO convergence vs random search vs manual grid** (same budget, same seed, plus the full-grid optimum line); **cost landscape heatmap** over (s, Q) with BO samples numbered in order, the optimum starred, and infeasible regions hatched; **tornado** of +/-20% sensitivities; baseline reproduction of the professor's three one-at-a-time sweeps (in day units, labelled) |
| **5. Methodology** | formulas (rendered), assumptions, the precomputed vs live split, limitations, future improvements, at least 8 Harvard references, dataset attribution with the MIT notice |

Every chart has a title and labelled axes with units. Under every chart and table there is a plain-language explanation built by a `narrative/` function from the live numbers. Example: "At 95% service SKU A needs 1,234 units on hand when you reorder. 61% of the buffer covers lead-time uncertainty, so a more reliable supplier would cut it by up to 520 units."

**WebGL:** not used. The largest chart is a 400-cell heatmap plus 40 points, which canvas rendering handles easily. WebGL would add bundle weight with no benefit.

---

## 7. Visual design language

- **Theme: "Warehouse control tower at night."** Background deep navy-charcoal `#0A0F1C`, with a faint isometric pallet-rack grid pattern at 4% opacity.
- **Glass panels:** `rgba(255,255,255,0.04)` fill, `backdrop-filter: blur(16px)`, 1 px `rgba(255,255,255,0.08)` border, 16 px radius, soft inner highlight.
- **Semantic colour, fixed across every chart:**
  - Baseline: amber `#F5A524`
  - AI-enhanced: teal `#2DD4BF`
  - Forecast / bands: sky `#38BDF8`
  - Stockout risk: rose `#F43F5E`
  - Infeasible region: slate hatch
  - Monte Carlo: violet `#A78BFA`
- **Type:** Inter for UI, JetBrains Mono (tabular figures) for numbers.
- **Motion (Framer Motion, purposeful only):** page cross-fade and slide (200 ms), staggered panel entry, KPI number tweening when values change, a shimmer on panels while a worker recomputes, and layout animation when the decision state changes. Turned off under `prefers-reduced-motion`.
- **Responsive:** 12-column grid on desktop, 1 column on phones, no horizontal scroll, 44 px touch targets.

---

## 8. File and folder structure

```
Lab 1 - dashboard/
  archive/retail_sales.csv            raw Kaggle file (gitignored, never deployed)
  docs/IMPLEMENTATION_PLAN.md         this plan
  scripts/
    prepare-data.ts                   stream CSV, weekly aggregation, holdout split -> public/data/skus.json
    train-lstm.ts                     offline seeded LSTM training -> public/models/
  public/
    data/skus.json                    3 SKUs x 260 weeks (about 30 KB)
    models/lstm-{A,B,C}.json + .bin   initial LSTM weights
  src/
    lib/
      rng.ts  stats.ts                seeded PRNG, normal quantile, gamma sampler, quantiles
      data/  schema.ts csv.ts weekly.ts persistence.ts
      forecast/  features.ts metrics.ts naive.ts holtWinters.ts ridge.ts trees.ts lstm.ts evaluate.ts forecast.ts
      inventory/ safetyStock.ts monteCarlo.ts simulator.ts policies.ts decision.ts
      optim/     gp.ts bayesOpt.ts randomSearch.ts grid.ts sensitivity.ts
      narrative/ forecast.ts risk.ts optim.ts decision.ts
    workers/ forecast.worker.ts optim.worker.ts client.ts
    state/   store.ts scenarios.ts defaults.ts
    components/ ui/ (GlassPanel, KpiTile, Slider, Segmented, Drawer, Explainer...)  charts/ (one file per chart)
    pages/   ControlTower.tsx Forecasting.tsx Risk.tsx Optimisation.tsx Methodology.tsx
    App.tsx  main.tsx  styles.css
  tests/    *.test.ts (Vitest)
  index.html  package.json  vite.config.ts  tsconfig.json  vercel.json  README.md  .gitignore
```

Stack: Vite 5, React 18, TypeScript (strict), Tailwind CSS, Framer Motion, Apache ECharts (tree-shaken core), TensorFlow.js (loaded only inside the forecast worker), Zustand, Papa Parse, idb-keyval, Vitest.

`.gitignore` excludes `archive/`, `node_modules/` and `dist/`, plus the course reference files (`Untitled5.ipynb`, the slide screenshot, `engine.py`), so only the app and the 3-SKU weekly extract are public. Only aggregated weekly totals for 3 series are deployed, never the raw dataset.

**Supporting Python notebook: not needed.** Python here has no numpy, pandas, scikit-learn or TensorFlow installed. Training the LSTM with TensorFlow.js in Node means the offline and in-browser LSTM use the same code, so there is nothing to keep in sync. `engine.py` is used only to cross-check formulas and logic. Its seeding bug (`hash(product)` changes every run) will not be ported.

---

## 9. Testing approach

- **Unit tests (Vitest), run before every stop:**
  - SS fixture: 474.9 / 1,618.9
  - static SS: 151.2
  - normal quantiles: z(0.95) = 1.6449, z(0.99) = 2.3263
  - gamma sampler mean and sd within 1% at n = 200k
  - Monte Carlo quantile vs the closed form when sigma_L = 0
  - metrics on hand-worked vectors
  - leakage guard on features
  - walk-forward never fits on test rows
  - ridge vs closed-form solution
  - simulator conservation (inventory balance identity) and cost decomposition
  - GP interpolates its training points at near-zero noise
  - EI is non-negative and zero at the incumbent when variance is zero
  - BO beats random search on a known quadratic
  - CSV validator accepts and rejects the right fixtures
- **Reproducibility:** the same seed gives identical outputs (snapshot of key numbers).
- **Integration (Phase 4):** walk the traceability table in the built-in browser against `vite preview` (production build): every control, every preset, upload valid and invalid CSVs, manual entry, stream 30 weeks, check the version log, check the console has no errors or warnings, check a phone viewport.

---

## 10. Vercel deployment steps (Phase 4 detail)

1. Create a personal GitHub repo and push the project. `archive/` stays local.
2. In Vercel (your Hobby account): Add New, then Project, then Import the repo.
3. Framework preset: Vite. Build command `npm run build`. Output directory `dist`. Install command `npm install`. No environment variables.
4. `vercel.json`: an SPA rewrite to `/index.html` and long-cache headers for `/assets/*`.
5. Deploy, then run the Phase 4 smoke test on the production URL.

**Prerequisite missing on this PC:** Node.js and git are not installed. Development needs Node.js 22 LTS and Git, for example `winget install OpenJS.NodeJS.LTS` and `winget install Git.Git`.

---

## 11. Traceability

### 11.1 Slide requirements

| # | Slide requirement | Delivered by |
|---|---|---|
| S0 | Enhance the ROP calculator and sensitivity analysis with predictive intelligence, adaptive decisions and real-time optimisation | Whole app; Control Tower "Baseline vs AI-enhanced" table proves the improvement |
| S1.1 | ML models (time series, regression, LSTM) using history, seasonality, promotions, external factors | Forecasting page: 7 models incl. Holt-Winters, Ridge, RF, GBM, LSTM; features: lags, week-of-year, trend, promo days, price index, optional uploaded exogenous columns |
| S1.2 | Keep the possibility of adding new data | CSV upload with validation, manual entry, Stream next period |
| S1.3 | Continuously update forecasts as data arrives | Auto-retrain + LSTM fine-tune on each arrival; version log shows WAPE / sigma_D / ROP over versions |
| S2.1 | Probabilistic models for demand variability and lead-time uncertainty | Slide formula with forecast-error sigma_D and sigma_L; gamma lead-time model |
| S2.2 | Monte Carlo for risk scenarios and buffers | Risk page: 20k-draw LTD histogram, ROP_MC, shaded stockout tail; scenario presets |
| S2.3 | Formula SS = Z * sqrt(sigma_D^2 L + Dbar^2 sigma_L^2) | `safetyStock.ts`, unit-tested with the fixture; shown on Risk and Methodology pages |
| S3 | Bayesian optimisation instead of manual sweeps, optimal ROP under constraints | Optimisation page: GP + EI over (s, Q) with service, capacity and budget penalties; convergence vs random vs grid; heatmap; tornado |

### 11.2 Professor's notebook (baseline)

| # | Baseline item | Delivered by |
|---|---|---|
| B1 | ROP = d * L + SS, fixed SS = 200 | "Professor fixed SS" policy in the comparison table; flat baseline line on the dynamic ROP chart |
| B2 | One-at-a-time sweeps of L 1-10, d 50-150, SS 0-300 | Optimisation page "Baseline reproduction" small multiples (day units), next to BO |
| B3 | Static SS = Z * sigma * sqrt(L), 80-99% | "Baseline" curve on SS vs service level; "Professor static SS" policy |
| B4 | Holding cost of SS by service level | Holding-cost axis on the SS vs service-level chart |
| B5 | Naive vs Random Forest, MAPE and WAPE | Both in the leaderboard, plus RMSE and Bias |
| B6 | RF evaluated in-sample (leakage) | Fixed: chronological walk-forward; Methodology explains the flaw; leakage unit test |

### 11.3 Brief requirements

| Requirement | Delivered by |
|---|---|
| Forecast vs actual with uncertainty bands + leaderboard | Forecasting page |
| MC LTD distribution, ROP marked, risk shaded | Risk page |
| Inventory simulation vs ROP with arrivals | Risk page |
| BO vs random vs grid, same budget and seed | Optimisation page |
| Cost heatmap (s, Q), BO points, infeasible shaded | Optimisation page |
| Tornado +/-20% on Dbar, sigma_D, L, sigma_L, h, p | Optimisation page |
| SS vs service level: baseline, formula, MC | Risk page |
| Dynamic ROP vs flat baseline | Control Tower |
| Controls: service level, L, sigma_L, h, p, K, min service / fill rate, capacity, budget | Global left rail |
| Presets: Normal, Demand surge, Supplier disruption, Promotion period, Combined crisis | Global left rail (`scenarios.ts`) |
| Decision panel: Order now / Watch / Healthy, stockout probability, weeks of cover | Control Tower |
| CSV upload + validation, manual entry, stream simulator, version log | Forecasting page data intake |
| Live-number explanations under every chart and table | `narrative/` functions, `<Explainer>` component |
| Web Workers, responsive, no console errors | `workers/`, Phase 4 checks |
| Methodology with 8+ Harvard references | Methodology page |
| Out-of-sample only; sigma_D from forecast errors; Dbar = mean forecast over LT | `evaluate.ts`, `forecast.ts`, tests |
| MC: gamma LT, conditional LTD, at least 10k draws, quantile ROP | `monteCarlo.ts` (20k) |
| CSL vs fill rate reported and explained | Risk page explainer; comparison table |
| GP + EI, s and Q, penalties, CRN, vs random and grid | `optim/` |
| Seeded randomness everywhere | `rng.ts`; reproducibility test |
| Fixture SS 474.9 / ROP 1,618.9 / static 151.2 | `tests/safetyStock.test.ts` |
| Short hyphens only | lint check in tests (searches src and docs for U+2013 / U+2014) |

### 11.4 Lab activity slide (Part 6, Bullwhip Lab page)

| # | Lab slide requirement | Delivered by |
|---|---|---|
| L0 | Mini-simulation of the bullwhip effect; redesign the network with AI levers (forecasting, routing) | Bullwhip Lab page, three runs on the same demand: (a) baseline, (b) AI forecasting, (c) AI forecasting + AI routing |
| L1 | Define the simulation environment: stages, lead times, order quantities, inventory levels | Step 1 panel: Customers, 3 retailers (item_20 at store_2, store_9, store_30), 2 distributors, 1 manufacturer; per-stage lead time, order rule, starting stock, holding and backlog cost; per-lane shipping cost |
| L2 | Base simulation without AI showing variation amplifying up the chain | Step 2: moving-average forecasts, order-up-to, fixed routing, first-come-first-served rationing; amplification emerges from ordering behaviour (`src/lib/bullwhip/simulate.ts`) |
| L3 | AI forecasting of customer demand used by retailers to order | Step 3: retailers use the best out-of-sample ML forecast; with information sharing, upstream uses the shared customer-demand forecast |
| L4 | AI for routing or allocation (optimisation or reinforcement learning) | Step 4: weekly transportation LP solved exactly as a min-cost flow (`src/lib/bullwhip/allocation.ts`), plus network re-planning to the cheapest lanes; Q-learning listed as future work |
| L5 | Definition of the bullwhip effect | Quoted on the page header |
| L6 | Visuals: orders by stage, bullwhip ratio per stage, cost / fill rate / backlog / inventory per stage, network diagram, live explanation | Bullwhip Lab charts and table; explanations generated from live numbers |
| L7 | Controls: lead times, forecast window, information sharing, routing view, demand shock | Step 1 controls; all three runs recompute in a worker |

### 11.5 Starter notebook bullwhip cells (cells 3 and 4)

| # | Notebook item | Delivered by |
|---|---|---|
| N1 | 4-tier chain multiplying demand by 1.2 per tier with a 1-week delay | Replaced by an ordering-behaviour simulation; the notebook's implied variance ratios (1.44, 2.07, 2.99) are drawn as a reference on the ratio chart |
| N2 | "AI-optimised" version: linear trend forecast and multiplier 1.05 | Replaced by real ML forecasts and information sharing (run b) and optimised routing (run c) |
| N3 | No random seed; new demand drawn for the second run | All runs share one demand series and seeded randomness; a determinism test checks it |

### 11.6 Part 6 tests

`tests/bullwhip.test.ts` checks that:
- the baseline bullwhip ratio is above 1 and grows upstream;
- information sharing reduces upstream amplification;
- the allocation never ships more than distributor stock or retailer need, never uses a closed lane, and is optimal against 5,000 random feasible plans;
- costs add up and match inventory and lane volumes;
- the runs share the same demand and are deterministic.

---

## 12. Time estimate and risks

| Part | Estimate |
|---|---|
| Setup: install Node and Git, scaffold, data prep script | 0.5 h |
| Part 1: data and models (features, 7 models, walk-forward, LSTM offline + fine-tune, tests) | 2.5 h |
| Part 2: safety stock, Monte Carlo, simulator, policies (tests) | 1.5 h |
| Part 3: BO, random, grid, tornado (tests) | 1.5 h |
| Part 4: dashboard UI (5 pages, 14 charts, controls, presets, decision panel, data intake, narratives) | 3.5 h |
| Part 5: integration (workers, persistence, performance, console clean-up) | 1 h |
| Phase 4: testing, README with demo script, deployment | 1 h |
| **Total** | **about 11.5 h of build time, plus your review at each stop** |

| Risk | Impact | Fallback |
|---|---|---|
| Overall scope vs today's deadline | High | Build order follows the slide's core first. If time runs short, the first cuts are the per-model test-window overlay, the version-trend chart and the lead-time inset. No slide requirement is cut |
| TensorFlow.js LSTM (bundle size, determinism, worker setup) | Medium | Keep the offline-trained LSTM for forecasting and the leaderboard, and make browser fine-tuning a button rather than automatic. Other models still retrain live. Stated honestly |
| GP hyperparameter fitting unstable | Low | Fixed length-scales from a marginal-likelihood grid only |
| Node / Git not installed | Blocks start | winget install (2-3 min) with your OK |
| Hobby + GitHub organisation repo | Blocks deploy | Use a personal repo |
| Synthetic data makes models look "too good" | Credibility | Stated openly on the Methodology page; stress scenarios show the value of probabilistic buffers anyway |

---

## 13. References planned for the Methodology page (Harvard)

Axsäter, S. (2015) *Inventory Control*. 3rd edn. Cham: Springer.
Breiman, L. (2001) 'Random forests', *Machine Learning*, 45(1), pp. 5-32.
Eppen, G.D. and Martin, R.K. (1988) 'Determining safety stock in the presence of stochastic lead time and demand', *Management Science*, 34(11), pp. 1380-1390.
Friedman, J.H. (2001) 'Greedy function approximation: a gradient boosting machine', *Annals of Statistics*, 29(5), pp. 1189-1232.
Glasserman, P. and Yao, D.D. (1992) 'Some guidelines and guarantees for common random numbers', *Management Science*, 38(6), pp. 884-908.
Hochreiter, S. and Schmidhuber, J. (1997) 'Long short-term memory', *Neural Computation*, 9(8), pp. 1735-1780.
Hyndman, R.J. and Athanasopoulos, G. (2021) *Forecasting: Principles and Practice*. 3rd edn. Melbourne: OTexts.
Hyndman, R.J. and Koehler, A.B. (2006) 'Another look at measures of forecast accuracy', *International Journal of Forecasting*, 22(4), pp. 679-688.
Jones, D.R., Schonlau, M. and Welch, W.J. (1998) 'Efficient global optimization of expensive black-box functions', *Journal of Global Optimization*, 13(4), pp. 455-492.
Marsaglia, G. and Tsang, W.W. (2000) 'A simple method for generating gamma variables', *ACM Transactions on Mathematical Software*, 26(3), pp. 363-372.
Rasmussen, C.E. and Williams, C.K.I. (2006) *Gaussian Processes for Machine Learning*. Cambridge, MA: MIT Press.
Silver, E.A., Pyke, D.F. and Thomas, D.J. (2017) *Inventory and Production Management in Supply Chains*. 4th edn. Boca Raton: CRC Press.
Snoek, J., Larochelle, H. and Adams, R.P. (2012) 'Practical Bayesian optimization of machine learning algorithms', *Advances in Neural Information Processing Systems 25*, pp. 2951-2959.
Winters, P.R. (1960) 'Forecasting sales by exponentially weighted moving averages', *Management Science*, 6(3), pp. 324-342.

Each reference will be re-verified (DOI or publisher page) before the Methodology page is finalised.
