/**
 * Feature engineering for the regression and tree models.
 *
 * Leakage rule: the feature vector for target week t reads demand only from weeks
 * 0..t-1. Exogenous inputs for week t (promotion days, price, uploaded factors) are
 * allowed because promotions and prices are planned in advance.
 */
import { yearPhase } from "../calendar";

/** Exogenous information for one week (known before the week happens). */
export interface ExoRow {
  week: string;
  promoDays: number;
  price: number;
  extra?: Record<string, number>;
}

export interface FeatureContext {
  basePrice: number;
  /** Names of optional uploaded numeric columns used as extra regressors. */
  extraKeys: string[];
}

/** Weeks of history needed before a feature row can be built (for the 52-week lag). */
export const MIN_HISTORY = 52;

export const BASE_FEATURES = [
  "lag1",
  "lag2",
  "lag3",
  "lag4",
  "lag52",
  "rollMean4",
  "rollStd4",
  "seasonSin",
  "seasonCos",
  "trend",
  "promoDays",
  "priceIndex",
] as const;

export function featureNames(ctx: FeatureContext): string[] {
  return [...BASE_FEATURES, ...ctx.extraKeys];
}

/**
 * Feature vector for target index t. `demand` must hold values for indices 0..t-1
 * (actuals, or earlier forecasts during recursive multi-step forecasting).
 */
export function featureRow(demand: ArrayLike<number>, t: number, exo: ExoRow, ctx: FeatureContext): number[] {
  if (t < MIN_HISTORY) throw new Error(`featureRow: need at least ${MIN_HISTORY} weeks of history`);
  const l1 = demand[t - 1];
  const l2 = demand[t - 2];
  const l3 = demand[t - 3];
  const l4 = demand[t - 4];
  const rm = (l1 + l2 + l3 + l4) / 4;
  const rs = Math.sqrt(((l1 - rm) ** 2 + (l2 - rm) ** 2 + (l3 - rm) ** 2 + (l4 - rm) ** 2) / 3);
  const phase = 2 * Math.PI * yearPhase(exo.week);
  const row = [
    l1,
    l2,
    l3,
    l4,
    demand[t - 52],
    rm,
    rs,
    Math.sin(phase),
    Math.cos(phase),
    t,
    exo.promoDays,
    exo.price / ctx.basePrice,
  ];
  for (const k of ctx.extraKeys) row.push(exo.extra?.[k] ?? 0);
  return row;
}
