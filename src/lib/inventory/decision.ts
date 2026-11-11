/** Replenishment decision for the decision panel. Time unit: weeks. */
import { exceedanceProb } from "./monteCarlo";

export type DecisionStatus = "order" | "watch" | "healthy";

export interface DecisionInput {
  onHand: number;
  onOrder: number;
  backorders: number;
  /** Reorder point that applies this week (the adaptive one). */
  rop: number;
  /** Order quantity (Bayesian-optimised). */
  Q: number;
  /** Forecast demand for the coming weeks. */
  weeklyForecast: number[];
  /** Sorted Monte Carlo lead-time demand sample. */
  ltdSorted: Float64Array;
}

export interface Decision {
  status: DecisionStatus;
  inventoryPosition: number;
  orderQty: number;
  /** P(lead-time demand > inventory position): stockout risk before a new order could arrive. */
  stockoutProb: number;
  /** Same risk if the order is postponed by one week. */
  stockoutProbIfWait: number;
  /** Weeks until on-hand stock (net of backorders) runs out at the forecast rate. */
  weeksOfCover: number;
  /** Units above (+) or below (-) the reorder point. */
  headroom: number;
}

export function weeksOfCover(stock: number, forecast: number[]): number {
  if (stock <= 0) return 0;
  let left = stock;
  for (let w = 0; w < forecast.length; w++) {
    const d = Math.max(forecast[w], 1e-9);
    if (left <= d) return w + left / d;
    left -= d;
  }
  return forecast.length;
}

export function decide(inp: DecisionInput): Decision {
  const ip = inp.onHand + inp.onOrder - inp.backorders;
  const nextWeek = inp.weeklyForecast[0] ?? 0;
  let status: DecisionStatus;
  let orderQty = 0;
  if (ip <= inp.rop) {
    status = "order";
    const Q = Math.max(1, Math.round(inp.Q));
    orderQty = Q * Math.max(1, Math.ceil((inp.rop - ip + 1e-9) / Q));
  } else if (ip - nextWeek <= inp.rop) {
    status = "watch";
  } else {
    status = "healthy";
  }
  return {
    status,
    inventoryPosition: ip,
    orderQty,
    stockoutProb: exceedanceProb(inp.ltdSorted, ip),
    stockoutProbIfWait: exceedanceProb(inp.ltdSorted, ip - nextWeek),
    weeksOfCover: weeksOfCover(inp.onHand - inp.backorders, inp.weeklyForecast),
    headroom: ip - inp.rop,
  };
}
