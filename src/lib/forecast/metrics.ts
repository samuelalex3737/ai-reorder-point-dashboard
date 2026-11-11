/** Forecast accuracy metrics (Hyndman and Koehler, 2006). Errors are actual minus forecast. */

export interface Metrics {
  /** Mean absolute percentage error, %. Weeks with zero demand use a denominator of 1. */
  mape: number;
  /** Weighted absolute percentage error, % (sum |e| / sum actual). */
  wape: number;
  /** Root mean squared error, units per week. */
  rmse: number;
  /** Mean absolute error, units per week. */
  mae: number;
  /** Bias, % (sum(forecast - actual) / sum actual). Positive = over-forecasting. */
  bias: number;
}

export function computeMetrics(actual: ArrayLike<number>, forecast: ArrayLike<number>): Metrics {
  const n = actual.length;
  if (n === 0 || forecast.length !== n) throw new Error("metrics: length mismatch or empty");
  let ape = 0;
  let abs = 0;
  let sq = 0;
  let tot = 0;
  let signed = 0;
  for (let i = 0; i < n; i++) {
    const e = actual[i] - forecast[i];
    ape += Math.abs(e) / Math.max(Math.abs(actual[i]), 1);
    abs += Math.abs(e);
    sq += e * e;
    tot += actual[i];
    signed += forecast[i] - actual[i];
  }
  return {
    mape: (ape / n) * 100,
    wape: (abs / tot) * 100,
    rmse: Math.sqrt(sq / n),
    mae: abs / n,
    bias: (signed / tot) * 100,
  };
}
