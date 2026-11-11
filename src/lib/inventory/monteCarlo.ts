/**
 * Monte Carlo simulation of demand during lead time (LTD).
 *
 * For each draw: lead time ~ Gamma(mean L, sd sigma_L) (positive, right-skewed), then
 * LTD | lead time ~ Normal(Dbar * lt, sigma_D * sqrt(lt)), truncated at zero.
 * ROP_MC is the service-level quantile of LTD; SS_MC = ROP_MC - Dbar * L.
 */
import { drawLeadTime, Rng } from "../rng";
import { mean, quantileSorted, sd } from "../stats";
import { safetyStockSlide, safetyStockStatic, SERVICE_GRID, zFor } from "./safetyStock";

export interface McInput {
  dBar: number;
  sigmaD: number;
  L: number;
  sigmaL: number;
  serviceLevel: number;
  /** Order quantity, used for the fill rate implied by a reorder point. */
  orderQty: number;
  draws?: number;
  seed?: number;
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}

export interface McResult {
  draws: number;
  /** Sorted LTD sample. */
  ltd: Float64Array;
  ltdMean: number;
  ltdSd: number;
  leadTimeMean: number;
  leadTimeSd: number;
  leadTimeP95: number;
  ropMC: number;
  ssMC: number;
  /** Slide-formula ROP for the same inputs, for comparison. */
  ropFormula: number;
  ssFormula: number;
  /** P(LTD > ROP_formula) estimated from the sample. */
  stockoutProbAtFormula: number;
  /** Fill rate implied by ROP_MC and the order quantity: 1 - E[(LTD - ROP)+] / Q. */
  impliedFillRate: number;
  histogram: HistogramBin[];
  leadTimeHistogram: HistogramBin[];
}

export const MC_DRAWS = 20_000;
export const MC_SEED = 2024;

/** P(X > x) for a sorted sample. */
export function exceedanceProb(sorted: Float64Array, x: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= x) lo = mid + 1;
    else hi = mid;
  }
  return (sorted.length - lo) / sorted.length;
}

/** E[(X - x)+] for a sorted sample. */
export function expectedShortage(sorted: Float64Array, x: number): number {
  let s = 0;
  for (let i = sorted.length - 1; i >= 0 && sorted[i] > x; i--) s += sorted[i] - x;
  return s / sorted.length;
}

function histogram(sorted: Float64Array, bins: number): HistogramBin[] {
  const lo = sorted[0];
  const hi = sorted[sorted.length - 1];
  const w = (hi - lo) / bins || 1;
  const out: HistogramBin[] = Array.from({ length: bins }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, count: 0 }));
  for (let i = 0; i < sorted.length; i++) out[Math.min(bins - 1, Math.floor((sorted[i] - lo) / w))].count++;
  return out;
}

export function sampleLtd(inp: Pick<McInput, "dBar" | "sigmaD" | "L" | "sigmaL" | "draws" | "seed">): { ltd: Float64Array; lt: Float64Array } {
  const n = inp.draws ?? MC_DRAWS;
  const rng = new Rng(inp.seed ?? MC_SEED);
  const ltd = new Float64Array(n);
  const lt = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const l = drawLeadTime(rng, inp.L, inp.sigmaL);
    lt[i] = l;
    ltd[i] = Math.max(0, inp.dBar * l + inp.sigmaD * Math.sqrt(l) * rng.normal());
  }
  ltd.sort();
  lt.sort();
  return { ltd, lt };
}

export function runMonteCarlo(inp: McInput): McResult {
  const { ltd, lt } = sampleLtd(inp);
  const ropMC = quantileSorted(ltd, inp.serviceLevel);
  const z = zFor(inp.serviceLevel);
  const ssFormula = safetyStockSlide({ z, sigmaD: inp.sigmaD, L: inp.L, dBar: inp.dBar, sigmaL: inp.sigmaL });
  const ropFormula = inp.dBar * inp.L + ssFormula;
  return {
    draws: ltd.length,
    ltd,
    ltdMean: mean(ltd),
    ltdSd: sd(ltd),
    leadTimeMean: mean(lt),
    leadTimeSd: sd(lt),
    leadTimeP95: quantileSorted(lt, 0.95),
    ropMC,
    ssMC: ropMC - inp.dBar * inp.L,
    ropFormula,
    ssFormula,
    stockoutProbAtFormula: exceedanceProb(ltd, ropFormula),
    impliedFillRate: Math.max(0, 1 - expectedShortage(ltd, ropMC) / Math.max(inp.orderQty, 1)),
    histogram: histogram(ltd, 60),
    leadTimeHistogram: histogram(lt, 40),
  };
}

export interface ServiceCurvePoint {
  serviceLevel: number;
  z: number;
  /** Professor: Z * sigma_raw * sqrt(L). */
  ssBaseline: number;
  /** Slide formula with forecast-error sigma_D and sigma_L. */
  ssFormula: number;
  /** Monte Carlo quantile minus Dbar * L. */
  ssMonteCarlo: number;
  /** Weekly holding cost of each buffer (h * SS). */
  holdBaseline: number;
  holdFormula: number;
  holdMonteCarlo: number;
}

/** Safety stock against service level (80-99%) for the three methods, from one LTD sample. */
export function serviceCurve(
  ltdSorted: Float64Array,
  p: { dBar: number; sigmaD: number; L: number; sigmaL: number; sigmaRaw: number; holdingCost: number },
): ServiceCurvePoint[] {
  return SERVICE_GRID.map((sl) => {
    const z = zFor(sl);
    const ssBaseline = safetyStockStatic(z, p.sigmaRaw, p.L);
    const ssFormula = safetyStockSlide({ z, sigmaD: p.sigmaD, L: p.L, dBar: p.dBar, sigmaL: p.sigmaL });
    const ssMonteCarlo = quantileSorted(ltdSorted, sl) - p.dBar * p.L;
    return {
      serviceLevel: sl,
      z,
      ssBaseline,
      ssFormula,
      ssMonteCarlo,
      holdBaseline: ssBaseline * p.holdingCost,
      holdFormula: ssFormula * p.holdingCost,
      holdMonteCarlo: ssMonteCarlo * p.holdingCost,
    };
  });
}
