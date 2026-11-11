import type { ReactNode } from "react";
import { MODEL_INFO, MODEL_KEYS } from "../lib/forecast/pipeline";
import { useStore } from "../state/store";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass p-5 sm:p-6">
      <h2 className="mb-3 text-[16px] font-semibold text-slate-100">{title}</h2>
      <div className="space-y-3 text-[13.5px] leading-relaxed text-slate-300">{children}</div>
    </section>
  );
}

function Formula({ children }: { children: ReactNode }) {
  return <div className="num overflow-x-auto rounded-xl bg-ink-950/60 px-4 py-3 text-[13px] text-ai">{children}</div>;
}

export const REFERENCES: string[] = [
  "Axsäter, S. (2015) Inventory Control. 3rd edn. Cham: Springer.",
  "Breiman, L. (2001) 'Random forests', Machine Learning, 45(1), pp. 5-32.",
  "Eppen, G.D. and Martin, R.K. (1988) 'Determining safety stock in the presence of stochastic lead time and demand', Management Science, 34(11), pp. 1380-1390.",
  "Friedman, J.H. (2001) 'Greedy function approximation: a gradient boosting machine', Annals of Statistics, 29(5), pp. 1189-1232.",
  "Glasserman, P. and Yao, D.D. (1992) 'Some guidelines and guarantees for common random numbers', Management Science, 38(6), pp. 884-908.",
  "Hochreiter, S. and Schmidhuber, J. (1997) 'Long short-term memory', Neural Computation, 9(8), pp. 1735-1780.",
  "Hyndman, R.J. and Athanasopoulos, G. (2021) Forecasting: Principles and Practice. 3rd edn. Melbourne: OTexts.",
  "Hyndman, R.J. and Koehler, A.B. (2006) 'Another look at measures of forecast accuracy', International Journal of Forecasting, 22(4), pp. 679-688.",
  "Jones, D.R., Schonlau, M. and Welch, W.J. (1998) 'Efficient global optimization of expensive black-box functions', Journal of Global Optimization, 13(4), pp. 455-492.",
  "Lee, H.L., Padmanabhan, V. and Whang, S. (1997) 'Information distortion in a supply chain: the bullwhip effect', Management Science, 43(4), pp. 546-558.",
  "Marsaglia, G. and Tsang, W.W. (2000) 'A simple method for generating gamma variables', ACM Transactions on Mathematical Software, 26(3), pp. 363-372.",
  "Rasmussen, C.E. and Williams, C.K.I. (2006) Gaussian Processes for Machine Learning. Cambridge, MA: MIT Press.",
  "Silver, E.A., Pyke, D.F. and Thomas, D.J. (2017) Inventory and Production Management in Supply Chains. 4th edn. Boca Raton: CRC Press.",
  "Snoek, J., Larochelle, H. and Adams, R.P. (2012) 'Practical Bayesian optimization of machine learning algorithms', Advances in Neural Information Processing Systems 25, pp. 2951-2959.",
  "Talukdar, D. (2026) Store Item Demand Forecasting Dataset [Dataset]. Kaggle. Available at: https://www.kaggle.com/datasets/dhrubangtalukdar/store-item-demand-forecasting-dataset (Accessed: 11 November 2026).",
  "Winters, P.R. (1960) 'Forecasting sales by exponentially weighted moving averages', Management Science, 6(3), pp. 324-342.",
];

export function Methodology() {
  const ds = useStore((s) => s.dataset!);
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Section title="What this dashboard does">
        <p>
          It covers two Session II tasks. The main exercise enhances the reorder-point calculator and sensitivity analysis from the starter notebook in three steps: (1) machine-learning demand forecasting that retrains as data arrives,
          (2) dynamic safety stock from the slide formula and a Monte Carlo simulation of demand and lead-time risk, and (3) Bayesian optimisation of the reorder point and order quantity under service, capacity and
          budget constraints, replacing one-at-a-time manual sweeps. The lab activity (Bullwhip Lab page) simulates the bullwhip effect and redesigns the network with AI forecasting and routing. Every number is computed live from the data and the controls.
        </p>
      </Section>

      <Section title="Data">
        <p>
          {ds.source.title} by {ds.source.author} ({ds.source.licence} licence): {ds.rawRows.toLocaleString("en-US")} daily rows, 50 stores x 50 items, 2019-2023, with promotion flags and prices. It is synthetic,
          complete (no gaps, duplicates or negatives) and very regular, so model errors are smaller than on real retail data. Daily sales were aggregated offline to 260 Monday-Sunday weeks for three store-item
          series chosen to span volume tiers: a fast mover, the dataset median and a noisy slow mover. Only these weekly totals are published; the raw file is not. The final {ds.holdoutWeeks} real weeks are held
          back and released by "Stream next period" to imitate live data.
        </p>
        <p className="text-xs text-slate-500">
          Dataset licence: MIT. Permission is granted, free of charge, to use, copy, modify, merge, publish and distribute the data, provided the copyright and permission notice are included. The data is provided
          "as is", without warranty of any kind.
        </p>
      </Section>

      <Section title="Step 1: demand forecasting">
        <p>Seven models are compared out of sample on the last 52 weeks of history, each week predicted one step ahead from data available at the time:</p>
        <ul className="list-disc space-y-1 pl-5">
          {MODEL_KEYS.map((k) => (
            <li key={k}>
              <span className="text-slate-100">{MODEL_INFO[k].name}</span> ({MODEL_INFO[k].family}): {MODEL_INFO[k].description}
            </li>
          ))}
        </ul>
        <p>
          Regression and tree models use lags 1-4 and 52, a 4-week rolling mean and sd, Fourier terms for the time of year, a trend index, promotion days and a price index (plus any numeric column uploaded for every
          week, such as a holiday flag or temperature). Every feature for week t uses demand from weeks before t only; a unit test feeds NaN for week t onward and checks that predictions are unaffected. The starter
          notebook trained and scored its Random Forest on the same 12 rows, which overstates accuracy; here the test window is never used for fitting.
        </p>
        <Formula>
          MAPE = mean(|e| / max(y,1)) x 100 &nbsp; WAPE = sum|e| / sum y x 100 &nbsp; RMSE = sqrt(mean e^2) &nbsp; Bias = sum(forecast - y) / sum y x 100
        </Formula>
        <p>
          The lowest-WAPE model becomes the forecaster. sigma_D is the standard deviation of its out-of-sample errors, so the buffer covers what the model cannot predict rather than seasonality and promotions it can.
          Forecast intervals widen as sigma_D x sqrt(h) over a horizon of h weeks.
        </p>
      </Section>

      <Section title="Step 2: dynamic safety stock and Monte Carlo">
        <Formula>
          SS = Z x sqrt(sigma_D^2 x L + Dbar^2 x sigma_L^2) &nbsp;&nbsp; ROP = Dbar x L + SS &nbsp;&nbsp; (baseline: SS = Z x sigma x sqrt(L))
        </Formula>
        <p>
          Z is the inverse normal of the cycle service level. Dbar is the mean forecast over the lead-time window, recomputed every week, which gives the adaptive reorder point. All quantities are in weeks and units per
          week; the unit test fixture (Z 1.6449, sigma_D 28, L 2, Dbar 572, sigma_L 0.5) gives SS 474.9 and ROP 1,618.9, and the baseline (sigma 65, L 2) gives 151.2.
        </p>
        <p>
          The Monte Carlo draws 20,000 lead times from a gamma distribution with mean L and sd sigma_L (shape (L/sigma_L)^2, scale sigma_L^2/L; positive and right-skewed) and, conditional on each lead time, demand
          from Normal(Dbar x lt, sigma_D x sqrt(lt)), truncated at zero. ROP_MC is the service-level quantile. Because the lead time is skewed, ROP_MC is usually above the formula ROP.
        </p>
        <p>
          The formula's Z sets a cycle service level (no stockout in a cycle) while the simulator measures the fill rate (share of units served). With order quantities much larger than the expected shortage per
          cycle, the fill rate is higher than the cycle service level; both are reported.
        </p>
      </Section>

      <Section title="Step 3: Bayesian optimisation">
        <p>
          The decision variables are the reorder point s and order quantity Q. The objective is the expected annual holding + stockout + ordering cost from a weekly-review (s, Q) simulator with backorders and gamma
          lead times (200 replications of 52 weeks after an 8-week warm-up). Constraints are penalties: 10,000,000 x shortfall below the fill-rate target, 200 per unit over storage capacity, and 2 per dollar over the
          optional inventory-value budget. Every policy is evaluated on the same seeded demand and lead-time draws (common random numbers), so the optimiser compares policies, not luck.
        </p>
        <p>
          The surrogate is a Gaussian process with a Matern 5/2 kernel and per-axis length-scales chosen by maximum marginal likelihood, fitted to log cost (capped at twice the best value so penalties do not swamp
          the scale). Expected Improvement picks the next point from 2,048 quasi-random candidates plus local candidates; the last 10 of 40 evaluations search a shrinking trust region around the best point. The
          initial design is the slide-formula and Monte Carlo policies (both with EOQ) plus 8 Latin-hypercube points. Random search gets the same two starting policies and the same budget and seed; the manual grid
          is 7 x 6 = 42 points; a 400-point grid is the reference and the heatmap.
        </p>
      </Section>

      <Section title="Session II lab: bullwhip mini-simulation (Bullwhip Lab page)">
        <p>
          <span className="text-slate-100">Step 1, environment.</span> Customers, three retailers, two distributors and one manufacturer, in weekly periods. The retailers are three real stores selling item_20 (the
          same product as SKU A): store_2, store_9 and store_30, chosen for clearly different volumes (about 400, 350 and 270 units a week) because the dataset has no city or cluster field. Their weekly sales over the
          52-week test window are the customer demand used by every run. Distributors and the manufacturer are modelled. Per stage the page sets the lead time, the order rule (order-up-to or a smoothed
          order-up-to that closes 40% of the gap), the starting stock, and holding and backlog costs; per distributor-to-retailer lane it sets the shipping cost. The manufacturer has unlimited capacity.
        </p>
        <Formula>Order-up-to level S = F x (L + 1) + z x sigma x sqrt(L + 1); order = max(0, S - inventory position); bullwhip ratio = Var(orders of a tier) / Var(customer demand)</Formula>
        <p>
          <span className="text-slate-100">Step 2, base simulation.</span> Every node forecasts the stream it sees (customer demand for retailers, incoming orders upstream) with a moving average, sizes safety
          stock from the moving standard deviation, and orders up to its target. Fixed legacy routing sends Retailers 1 and 2 to Distributor 1 and Retailer 3 to Distributor 2; shortages are rationed first come,
          first served. Amplification is not hard-coded: it emerges from forecast updating, lead times and safety-stock reactions (Lee, Padmanabhan and Whang, 1997).
        </p>
        <p>
          <span className="text-slate-100">Step 3, AI forecasting.</span> Retailers order from the best model in the main forecasting pipeline (LSTM excluded here to keep the lab interactive), using its one-step
          forecasts over the test window, so no forecast was fitted on the week it predicts. With information sharing on, distributors and the manufacturer plan on the shared customer-demand forecast and its error
          instead of the orders arriving from below.
        </p>
        <p>
          <span className="text-slate-100">Step 4, AI routing.</span> Each week a transportation LP chooses how much each distributor ships to each retailer, minimising shipping + backlog + holding cost, with
          distributor stock and retailer need as constraints and a higher backlog weight for retailers whose ML forecast shows they will run short. It is solved exactly as a min-cost flow (successive shortest paths).
          The AI router also re-plans the network so each retailer is planned on its cheapest-to-serve distributor. A tabular Q-learning agent compared against this optimiser was out of scope for the deadline and is
          listed under future improvements.
        </p>
        <p>
          The starter notebook's bullwhip cells multiplied each tier by 1.2 with a one-week delay and showed "AI" by lowering the multiplier to 1.05 after fitting a linear trend. They used no random seed, drew new
          demand for the second run (so the two runs were not comparable), and fixed the amplification in advance instead of letting it result from ordering decisions. Here every run uses the same demand and seeds,
          and the notebook's implied variance ratios (1.44, 2.07, 2.99) are shown only as a reference on the ratio chart.
        </p>
        <p className="text-xs text-slate-500">
          Lab assumptions: lead times are whole weeks; unmet orders are backlogged; the first 8 weeks are a warm-up and are not scored; the demand shock multiplies all retailers' demand over the chosen weeks and the
          ML forecasts are re-run on the shocked history, so they react with a realistic one-week lag.
        </p>
      </Section>

      <Section title="Where each computation runs">
        <p>
          The site is a static Vite + React build on Vercel (Hobby plan: functions capped at 300 s, 2 GB / 1 vCPU and 4 hours of active CPU a month). There are no server functions: forecasting, the LSTM, Monte Carlo,
          simulation and optimisation run in two Web Workers in the browser, so controls respond without network calls and uploaded data never leaves the device.
        </p>
        <p>
          Precomputed: (1) the weekly aggregation of the Kaggle file, and (2) the LSTM's starting weights, trained offline with the same TensorFlow.js code (seed 42, 120 epochs, weeks before the test window only).
          Live: every other model refits on every data change; the LSTM is fine-tuned from its previous weights for 12 epochs whenever the training window moves, and "Retrain LSTM from scratch" retrains it fully in
          the browser.
        </p>
      </Section>

      <Section title="Assumptions">
        <ul className="list-disc space-y-1 pl-5">
          <li>Lead times are not in the data. Defaults reuse the professor's Products A/B/C (L = 2, 3, 4 weeks) with sigma_L of 0.5, 0.8 and 1.2 weeks, gamma distributed. All are editable.</li>
          <li>Holding cost per unit-week (1.1, 1.3, 1.8) follows the notebook; stockout cost per unit (15, 18, 25) and ordering cost per order (1,500, 2,000, 1,200) follow the reference engine; capacity scales with volume.</li>
          <li>Unmet demand is backordered; the review period is one week; simulated lead times are rounded to whole weeks (minimum 1).</li>
          <li>Future promotions default to the historical average promotion days per week; the "Promotion period" preset plans 3 days a week for 8 weeks at the historical 20% discount.</li>
          <li>Simulated demand = forecast + Normal(0, sigma_D) error; scenario presets scale the forecast, sigma_D, L and sigma_L.</li>
        </ul>
      </Section>

      <Section title="Limitations">
        <ul className="list-disc space-y-1 pl-5">
          <li>The data is synthetic and regular; real retail demand would give larger errors, intermittent demand and genuine holiday effects.</li>
          <li>The LSTM is small (16 units) because each SKU has about 180 training weeks; with this little data it does not always beat ridge regression.</li>
          <li>Forecast intervals assume errors grow with the square root of the horizon and do not re-estimate the error per horizon.</li>
          <li>Penalties turn constraints into costs; a very small violation can still look attractive, so the optimiser prefers feasible points explicitly.</li>
          <li>With 40 evaluations, BO is not guaranteed to beat random search on every setting; the dashboard reports whichever result is better.</li>
        </ul>
      </Section>

      <Section title="Future improvements">
        <ul className="list-disc space-y-1 pl-5">
          <li>Real lead-time data per supplier and lane to fit the gamma parameters instead of assuming them.</li>
          <li>Probabilistic forecasts (quantile regression or conformal intervals) feeding the Monte Carlo directly.</li>
          <li>Multi-echelon and multi-SKU optimisation with shared capacity, and constrained BO with a separate GP for the service constraint.</li>
          <li>A tabular Q-learning or deep reinforcement learning agent for ordering and for the Bullwhip Lab's routing, compared against the optimised (s, Q) policy and the min-cost allocation.</li>
          <li>Capacity limits and production smoothing at the manufacturer in the Bullwhip Lab, and real store locations to set lane costs.</li>
          <li>A server-side retraining job (scheduled) once data volumes outgrow the browser.</li>
        </ul>
      </Section>

      <Section title="References">
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] [overflow-wrap:anywhere]">
          {REFERENCES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
