/**
 * Additive Holt-Winters exponential smoothing (Winters, 1960) with a 52-week season.
 * Smoothing parameters are chosen by grid search on one-step-ahead squared error over
 * the training range only.
 */

export const SEASON = 52;

export interface HwParams {
  alpha: number;
  beta: number;
  gamma: number;
}

interface HwState {
  level: number;
  trend: number;
  season: number[];
}

/** Initialise from the first two seasons. */
function init(y: ArrayLike<number>): HwState {
  let m1 = 0;
  let m2 = 0;
  for (let i = 0; i < SEASON; i++) {
    m1 += y[i] / SEASON;
    m2 += y[SEASON + i] / SEASON;
  }
  const trend = (m2 - m1) / SEASON;
  // Seasonal indices are deviations from the trend line through the first season's mean.
  const season = new Array(SEASON);
  for (let i = 0; i < SEASON; i++) season[i] = y[i] - (m1 + trend * (i - (SEASON - 1) / 2));
  // Level at the end of season 1, so the first update (week SEASON) applies one trend step.
  return { level: m1 + trend * ((SEASON - 1) / 2), trend, season };
}

/**
 * Run the filter over y[0..end) and return the state plus the one-step SSE accumulated
 * from week SEASON onward.
 */
function run(y: ArrayLike<number>, end: number, p: HwParams): { state: HwState; sse: number } {
  const st = init(y);
  let sse = 0;
  for (let t = SEASON; t < end; t++) {
    const s = st.season[t % SEASON];
    const yhat = st.level + st.trend + s;
    sse += (y[t] - yhat) ** 2;
    const prevLevel = st.level;
    st.level = p.alpha * (y[t] - s) + (1 - p.alpha) * (st.level + st.trend);
    st.trend = p.beta * (st.level - prevLevel) + (1 - p.beta) * st.trend;
    st.season[t % SEASON] = p.gamma * (y[t] - st.level) + (1 - p.gamma) * s;
  }
  return { state: st, sse };
}

export function fitHoltWinters(y: ArrayLike<number>, end: number): HwParams {
  if (end < 2 * SEASON + 4) throw new Error("Holt-Winters needs at least two seasons of history");
  let best: HwParams = { alpha: 0.2, beta: 0.01, gamma: 0.1 };
  let bestSse = Infinity;
  for (const alpha of [0.05, 0.1, 0.2, 0.3, 0.5, 0.7]) {
    for (const beta of [0, 0.005, 0.01, 0.05, 0.1]) {
      for (const gamma of [0.05, 0.1, 0.2, 0.3, 0.5]) {
        const { sse } = run(y, end, { alpha, beta, gamma });
        if (sse < bestSse) {
          bestSse = sse;
          best = { alpha, beta, gamma };
        }
      }
    }
  }
  return best;
}

/** One-step forecast for index t using y[0..t-1]. */
export function predictHoltWinters(y: ArrayLike<number>, t: number, p: HwParams): number {
  const { state } = run(y, t, p);
  return state.level + state.trend + state.season[t % SEASON];
}
