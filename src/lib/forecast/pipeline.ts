/**
 * Forecasting pipeline: out-of-sample model comparison, best-model selection, sigma_D,
 * and a recursive multi-step forecast with uncertainty bands.
 *
 * Evaluation protocol (no leakage):
 *  - chronological split: the last `testWeeks` weeks are the test window;
 *  - every model is fitted on weeks before the test window only;
 *  - each test week is predicted one step ahead from actual demand up to the previous week.
 * sigma_D is the standard deviation of the best model's out-of-sample errors.
 */
import { addWeeks } from "../calendar";
import { normInv, sd } from "../stats";
import type { WeekRow } from "../types";
import { featureRow, MIN_HISTORY, type ExoRow, type FeatureContext } from "./features";
import { fitHoltWinters, predictHoltWinters, SEASON } from "./holtWinters";
import type { LstmForecaster } from "./lstm";
import { LSTM_WINDOW } from "./lstmConfig";
import { computeMetrics, type Metrics } from "./metrics";
import { RidgeRegression } from "./ridge";
import { GradientBoosting, RandomForest } from "./trees";

export type ModelKey = "naive" | "seasonalNaive" | "holtWinters" | "ridge" | "randomForest" | "gradientBoosting" | "lstm";

export const MODEL_INFO: Record<ModelKey, { name: string; family: string; description: string }> = {
  naive: { name: "Naive (last week)", family: "Baseline", description: "Next week equals last week (the professor's baseline)." },
  seasonalNaive: { name: "Seasonal Naive (52 wk)", family: "Baseline", description: "Next week equals the same week last year." },
  holtWinters: { name: "Holt-Winters", family: "Time series", description: "Additive level, trend and 52-week seasonality, exponentially smoothed." },
  ridge: { name: "Ridge Regression", family: "Regression", description: "Linear model on lags, seasonality, trend, promotions and price." },
  randomForest: { name: "Random Forest", family: "Tree ensemble", description: "200 bootstrapped regression trees (the professor's model, now tested out of sample)." },
  gradientBoosting: { name: "Gradient Boosting", family: "Tree ensemble", description: "300 shallow trees fitted sequentially to residuals." },
  lstm: { name: "LSTM", family: "Deep learning", description: "Recurrent neural network over a 12-week window with planned promotions." },
};

export const MODEL_KEYS = Object.keys(MODEL_INFO) as ModelKey[];

export interface ModelResult {
  key: ModelKey;
  metrics: Metrics;
  /** One-step-ahead predictions over the test window. */
  testPred: number[];
  /** Forecast for the future horizon after refitting on all history. */
  futurePred: number[];
}

export interface ForecastPoint {
  week: string;
  mean: number;
  lo80: number;
  hi80: number;
  lo95: number;
  hi95: number;
  promoDays: number;
}

export interface PipelineResult {
  nRows: number;
  testStart: number;
  trainRows: number;
  testWeeks: string[];
  testActual: number[];
  models: ModelResult[];
  bestKey: ModelKey;
  /** Out-of-sample forecast error standard deviation of the best model, units per week. */
  sigmaD: number;
  /** Best model's out-of-sample errors (actual - forecast). */
  residuals: number[];
  forecast: ForecastPoint[];
  extraKeys: string[];
}

export interface PipelineInput {
  rows: WeekRow[];
  basePrice: number;
  /** Planned promotion days for each future week (its length sets the horizon). */
  futurePromo: number[];
  testWeeks?: number;
  /** An LSTM already trained on weeks before the test window, or null to skip it. */
  lstm: LstmForecaster | null;
}

type Predictor = (demand: number[], t: number) => number;

/** Extra regressors are used only when every row carries them (otherwise history would be zeros). */
export function sharedExtraKeys(rows: WeekRow[]): string[] {
  if (!rows.length || !rows[0].extra) return [];
  return Object.keys(rows[0].extra).filter((k) => rows.every((r) => r.extra && Number.isFinite(r.extra[k])));
}

/** Index of the first test week for a history of n weeks. */
export function testStartFor(n: number, testWeeks = 52): number {
  return n - testWeeks;
}

function fitPredictor(key: ModelKey, demand: number[], rows: ExoRow[], end: number, ctx: FeatureContext, lstm: LstmForecaster | null): Predictor {
  switch (key) {
    case "naive":
      return (d, t) => d[t - 1];
    case "seasonalNaive":
      return (d, t) => (t >= SEASON ? d[t - SEASON] : d[t - 1]);
    case "holtWinters": {
      const params = fitHoltWinters(demand, end);
      return (d, t) => predictHoltWinters(d, t, params);
    }
    case "lstm": {
      if (!lstm) throw new Error("LSTM not available");
      return (d, t) => lstm.predict(d, rows, t);
    }
    default: {
      const X: number[][] = [];
      const y: number[] = [];
      for (let t = MIN_HISTORY; t < end; t++) {
        X.push(featureRow(demand, t, rows[t], ctx));
        y.push(demand[t]);
      }
      const model =
        key === "ridge" ? new RidgeRegression(1.0).fit(X, y) : key === "randomForest" ? new RandomForest().fit(X, y) : new GradientBoosting().fit(X, y);
      return (d, t) => model.predict(featureRow(d, t, rows[t], ctx));
    }
  }
}

/** Exogenous rows for future weeks: planned promotions, price at the promo discount, last known extras. */
export function futureExoRows(rows: WeekRow[], basePrice: number, futurePromo: number[]): ExoRow[] {
  const last = rows[rows.length - 1];
  const discount = estimatePromoDiscount(rows, basePrice);
  return futurePromo.map((promoDays, h) => ({
    week: addWeeks(last.week, h + 1),
    promoDays,
    price: basePrice * (1 - (discount * promoDays) / 7),
    extra: last.extra ? { ...last.extra } : undefined,
  }));
}

/** Average promotional price cut implied by history (0.20 in this dataset). */
export function estimatePromoDiscount(rows: WeekRow[], basePrice: number): number {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    if (r.promoDays > 0) {
      num += (1 - r.price / basePrice) * 7;
      den += r.promoDays;
    }
  }
  return den > 0 ? Math.min(0.9, Math.max(0, num / den)) : 0;
}

export function runPipeline(input: PipelineInput): PipelineResult {
  const { rows, basePrice, futurePromo, lstm } = input;
  const testWeeks = input.testWeeks ?? 52;
  const n = rows.length;
  const testStart = testStartFor(n, testWeeks);
  if (testStart < 2 * SEASON + 4) throw new Error(`Need at least ${2 * SEASON + 4 + testWeeks} weeks of history`);
  const demand = rows.map((r) => r.demand);
  const extraKeys = sharedExtraKeys(rows);
  const ctx: FeatureContext = { basePrice, extraKeys };
  const future = futureExoRows(rows, basePrice, futurePromo);
  const allExo: ExoRow[] = [...rows, ...future];
  const testActual = demand.slice(testStart);
  const keys = MODEL_KEYS.filter((k) => k !== "lstm" || (lstm && testStart > LSTM_WINDOW));

  const models: ModelResult[] = keys.map((key) => {
    // Out-of-sample: fit on weeks before the test window, then predict one step ahead.
    const evalPredictor = fitPredictor(key, demand, allExo, testStart, ctx, lstm);
    const testPred: number[] = [];
    for (let t = testStart; t < n; t++) testPred.push(Math.max(0, evalPredictor(demand, t)));
    // Forecast: refit on all history (the LSTM keeps its training-window weights), then recurse.
    const fcPredictor = key === "lstm" ? evalPredictor : fitPredictor(key, demand, allExo, n, ctx, lstm);
    const ext = demand.slice();
    const futurePred: number[] = [];
    for (let h = 0; h < future.length; h++) {
      const v = Math.max(0, fcPredictor(ext, n + h));
      ext.push(v);
      futurePred.push(v);
    }
    return { key, metrics: computeMetrics(testActual, testPred), testPred, futurePred };
  });

  const best = models.reduce((a, b) => (b.metrics.wape < a.metrics.wape ? b : a));
  const residuals = testActual.map((y, i) => y - best.testPred[i]);
  const sigmaD = sd(residuals);
  const z80 = normInv(0.9);
  const z95 = normInv(0.975);
  const forecast: ForecastPoint[] = future.map((f, h) => {
    const spread = sigmaD * Math.sqrt(h + 1);
    const mean = best.futurePred[h];
    return {
      week: f.week,
      mean,
      lo80: Math.max(0, mean - z80 * spread),
      hi80: mean + z80 * spread,
      lo95: Math.max(0, mean - z95 * spread),
      hi95: mean + z95 * spread,
      promoDays: f.promoDays,
    };
  });

  return {
    nRows: n,
    testStart,
    trainRows: testStart - MIN_HISTORY,
    testWeeks: rows.slice(testStart).map((r) => r.week),
    testActual,
    models,
    bestKey: best.key,
    sigmaD,
    residuals,
    forecast,
    extraKeys,
  };
}
