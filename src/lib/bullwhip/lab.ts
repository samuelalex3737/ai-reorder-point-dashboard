/**
 * Bullwhip Lab engine: builds the three comparable runs on the same customer demand.
 *  (a) Baseline: moving-average forecasts at every node, fixed routing.
 *  (b) AI forecasting: retailers use the best ML forecast; upstream uses the shared
 *      customer-demand forecast when information sharing is on.
 *  (c) AI forecasting + AI routing: as (b), with min-cost allocation across distributors.
 *
 * The simulated horizon is the 52-week out-of-sample test window, so the ML forecasts used
 * by the retailers were never fitted on the weeks they predict.
 */
import { MODEL_INFO, runPipeline, type ModelKey } from "../forecast/pipeline";
import type { BullwhipFile, WeekRow } from "../types";
import { simulateBullwhip, type BullwhipConfig, type BullwhipResult, type RunMode } from "./simulate";

export const HORIZON = 52;
export const PRE_WEEKS = 12;
export const WARMUP = 8;

export interface ShockConfig {
  enabled: boolean;
  /** First shocked week within the horizon (0-based). */
  start: number;
  length: number;
  /** Relative demand increase, e.g. 0.4 = +40%. */
  size: number;
}

export interface LabInput {
  data: BullwhipFile;
  /** Weeks held back at the end of the dataset (not part of the lab's history). */
  holdoutWeeks: number;
  config: BullwhipConfig;
  shock: ShockConfig;
}

export type RunKey = "baseline" | "aiForecast" | "aiRouting";

export const RUNS: Record<RunKey, { name: string; short: string; mode: RunMode }> = {
  baseline: { name: "(a) Baseline: no AI", short: "Baseline", mode: { forecast: "naive", routing: "fixed" } },
  aiForecast: { name: "(b) AI forecasting", short: "AI forecasting", mode: { forecast: "ml", routing: "fixed" } },
  aiRouting: { name: "(c) AI forecasting + AI routing", short: "AI forecast + routing", mode: { forecast: "ml", routing: "optimised" } },
};
export const RUN_KEYS = Object.keys(RUNS) as RunKey[];

export interface RetailerForecastInfo {
  id: string;
  label: string;
  bestModel: string;
  wape: number;
  sigmaD: number;
  meanDemand: number;
}

export interface LabResult {
  weeks: string[];
  runs: Record<RunKey, BullwhipResult>;
  retailers: RetailerForecastInfo[];
  shockWeeks: [string, string] | null;
}

/** Retailer history with the optional demand shock applied inside the horizon. */
export function shockedRows(rows: WeekRow[], shock: ShockConfig): WeekRow[] {
  if (!shock.enabled) return rows;
  const h0 = rows.length - HORIZON;
  return rows.map((r, i) => {
    const k = i - h0;
    return k >= shock.start && k < shock.start + shock.length ? { ...r, demand: Math.round(r.demand * (1 + shock.size)) } : r;
  });
}

const forecastCache = new Map<string, { forecast: number[]; sigma: number; best: ModelKey; wape: number }>();

/** Out-of-sample one-step ML forecasts for the horizon (plus the week after), cached per demand. */
export function retailerForecast(rows: WeekRow[], basePrice: number, key: string): { forecast: number[]; sigma: number; best: ModelKey; wape: number } {
  const hit = forecastCache.get(key);
  if (hit) return hit;
  const promo = rows.reduce((a, r) => a + r.promoDays, 0) / rows.length;
  const res = runPipeline({ rows, basePrice, futurePromo: [promo], testWeeks: HORIZON, lstm: null });
  const best = res.models.find((m) => m.key === res.bestKey)!;
  const out = { forecast: [...best.testPred, res.forecast[0].mean], sigma: res.sigmaD, best: res.bestKey, wape: best.metrics.wape };
  if (forecastCache.size > 24) forecastCache.clear();
  forecastCache.set(key, out);
  return out;
}

export function runLab(inp: LabInput): LabResult {
  const histories = inp.data.retailers.map((r) => shockedRows(r.rows.slice(0, r.rows.length - inp.holdoutWeeks), inp.shock));
  const n = histories[0].length;
  const h0 = n - HORIZON;
  const shockKey = inp.shock.enabled ? `${inp.shock.start}|${inp.shock.length}|${inp.shock.size}` : "none";
  const fc = inp.data.retailers.map((r, i) => retailerForecast(histories[i], r.basePrice, `${r.id}|${n}|${shockKey}`));
  const demand = histories.map((h) => h.slice(h0).map((x) => x.demand));
  const preDemand = histories.map((h) => h.slice(h0 - PRE_WEEKS, h0).map((x) => x.demand));
  const runs = {} as Record<RunKey, BullwhipResult>;
  for (const k of RUN_KEYS) {
    runs[k] = simulateBullwhip({
      demand,
      preDemand,
      mlForecast: fc.map((f) => f.forecast),
      mlSigma: fc.map((f) => f.sigma),
      config: inp.config,
      mode: RUNS[k].mode,
      warmup: WARMUP,
    });
  }
  const weeks = histories[0].slice(h0).map((r) => r.week);
  return {
    weeks,
    runs,
    retailers: inp.data.retailers.map((r, i) => ({
      id: r.id,
      label: r.label,
      bestModel: MODEL_INFO[fc[i].best].name,
      wape: fc[i].wape,
      sigmaD: fc[i].sigma,
      meanDemand: demand[i].reduce((a, b) => a + b, 0) / demand[i].length,
    })),
    shockWeeks: inp.shock.enabled ? [weeks[inp.shock.start], weeks[Math.min(weeks.length - 1, inp.shock.start + inp.shock.length - 1)]] : null,
  };
}

export function defaultBullwhipConfig(): BullwhipConfig {
  return {
    retailer: { leadTime: 1, rule: "out", startCover: 2, holding: 1.0, backlog: 4 },
    distributor: { leadTime: 2, rule: "out", startCover: 2, holding: 0.6, backlog: 2 },
    manufacturer: { leadTime: 2, rule: "out", startCover: 2, holding: 0.4, backlog: 1 },
    // Legacy routing sends R2 to D1, although D2 -> R2 is the cheaper lane.
    laneCost: [
      [0.5, 0.9, 1.6],
      [1.4, 0.5, 0.4],
    ],
    assign: [0, 0, 1],
    window: 4,
    safetyZ: 1.65,
    smoothing: 0.4,
    infoSharing: true,
  };
}

export const DEFAULT_SHOCK: ShockConfig = { enabled: false, start: 20, length: 6, size: 0.4 };
