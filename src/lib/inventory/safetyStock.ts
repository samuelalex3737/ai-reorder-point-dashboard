/**
 * Safety stock and reorder point formulas. Time unit: weeks.
 *
 * Slide formula (demand and lead-time uncertainty, Silver, Pyke and Thomas, 2017):
 *   SS = Z * sqrt(sigma_D^2 * L + Dbar^2 * sigma_L^2),  ROP = Dbar * L + SS
 * Professor's static formula (ignores lead-time variability):
 *   SS = Z * sigma * sqrt(L)
 */
import { normInv } from "../stats";

export interface SlideInputs {
  /** Service level factor Z. */
  z: number;
  /** Demand standard deviation per week (forecast-error sd in the AI version). */
  sigmaD: number;
  /** Mean lead time, weeks. */
  L: number;
  /** Average weekly demand over the lead time. */
  dBar: number;
  /** Lead-time standard deviation, weeks. */
  sigmaL: number;
}

/** Z for a cycle service level (probability of no stockout per replenishment cycle). */
export function zFor(serviceLevel: number): number {
  return normInv(serviceLevel);
}

export function safetyStockSlide({ z, sigmaD, L, dBar, sigmaL }: SlideInputs): number {
  return z * Math.sqrt(sigmaD * sigmaD * L + dBar * dBar * sigmaL * sigmaL);
}

export function reorderPointSlide(inp: SlideInputs): number {
  return inp.dBar * inp.L + safetyStockSlide(inp);
}

export function safetyStockStatic(z: number, sigma: number, L: number): number {
  return z * sigma * Math.sqrt(L);
}

/** Share of lead-time demand variance due to demand noise vs lead-time uncertainty. */
export function varianceShares(sigmaD: number, L: number, dBar: number, sigmaL: number): { demand: number; leadTime: number } {
  const a = sigmaD * sigmaD * L;
  const b = dBar * dBar * sigmaL * sigmaL;
  const tot = a + b;
  return tot > 0 ? { demand: a / tot, leadTime: b / tot } : { demand: 1, leadTime: 0 };
}

/** Economic order quantity, consistent units: weekly demand and weekly holding cost per unit. */
export function eoq(weeklyDemand: number, orderCost: number, holdingCostPerWeek: number): number {
  return Math.sqrt((2 * orderCost * Math.max(weeklyDemand, 1e-9)) / Math.max(holdingCostPerWeek, 1e-9));
}

/** Service levels plotted on the safety stock curve: 80% to 99% in 1-point steps. */
export const SERVICE_GRID: number[] = Array.from({ length: 20 }, (_, i) => Math.round((0.8 + i * 0.01) * 100) / 100);
