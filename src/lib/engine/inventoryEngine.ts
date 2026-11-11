/**
 * Inventory engine: turns a forecast (mean path + sigma_D) and the dashboard controls into
 * safety stock, Monte Carlo risk, dynamic reorder points, a policy comparison on a shared
 * simulator, Bayesian optimisation of (s, Q), and a +/-20% sensitivity tornado.
 */
import { mean, sd } from "../stats";
import { runMonteCarlo, serviceCurve, type McResult, type ServiceCurvePoint } from "../inventory/monteCarlo";
import { eoq, safetyStockSlide, safetyStockStatic, varianceShares, zFor } from "../inventory/safetyStock";
import { generateDraws, simulate, SIM_WARMUP, type SimDraws, type SimResult, type TraceWeek } from "../inventory/simulator";
import { bayesianOptimise, bestOf, BO_BUDGET, OPT_SEED, gridSearch, linspace, randomSearch, type BoResult, type Box, type Evaluation, type Objective } from "../optim/bayesOpt";
import { SIM_WEEKS, type Controls, type Scenario } from "./params";

export interface EngineInput {
  /** Forecast mean per future week (scenario promotions already applied by the forecaster). */
  forecastMean: number[];
  /** Out-of-sample forecast error sd of the best model, units per week. */
  sigmaD: number;
  /** Actual weekly demand history. */
  history: number[];
  unitPrice: number;
  controls: Controls;
  scenario: Scenario;
}

export interface Effective {
  L: number;
  sigmaL: number;
  sigmaD: number;
  /** Mean forecast over the lead-time window starting next week. */
  dBar: number;
  /** Mean of the last 52 weeks of actual demand (what the static baseline uses). */
  dHist: number;
  /** Standard deviation of the last 52 weeks of raw demand (the professor's sigma). */
  sigmaRaw: number;
  z: number;
  eoq: number;
  /** Mean forecast weekly demand over the simulated year. */
  dYear: number;
}

export interface DynamicRopPoint {
  week: number;
  dBar: number;
  ss: number;
  rop: number;
}

export type PolicyKey = "fixed" | "static" | "dynamic" | "monteCarlo" | "bayes";

export interface PolicyResult {
  key: PolicyKey;
  name: string;
  kind: "baseline" | "ai";
  /** Reorder point (for dynamic: the first week's value) and order quantity. */
  s: number;
  sMax: number;
  Q: number;
  sim: SimResult;
  targetMet: boolean;
  capacityOk: boolean;
  trace: TraceWeek[];
}

export interface HeatCell {
  s: number;
  Q: number;
  cost: number;
  objective: number;
  fillRate: number;
  feasible: boolean;
}

export interface Optimisation {
  box: Box;
  gridS: number[];
  gridQ: number[];
  /** Full 20 x 20 grid (rows = Q, cols = s). */
  heat: HeatCell[][];
  bo: BoResult;
  random: Evaluation[];
  manual: Evaluation[];
  fullGridBest: HeatCell;
  /** BO best objective vs full-grid best, % above. */
  gapPct: number;
}

export interface TornadoBar {
  key: "dBar" | "sigmaD" | "L" | "sigmaL" | "h" | "p";
  label: string;
  baseValue: number;
  unit: string;
  ropFormulaLow: number;
  ropFormulaHigh: number;
  ropOptLow: number;
  ropOptHigh: number;
}

export interface Tornado {
  baseRopFormula: number;
  baseRopOpt: number;
  Q: number;
  bars: TornadoBar[];
}

export interface SweepSeries {
  x: number[];
  rop: number[];
}

export interface EngineResult {
  effective: Effective;
  ss: {
    formula: number;
    ropFormula: number;
    static: number;
    ropStatic: number;
    ropFixed: number;
    shares: { demand: number; leadTime: number };
  };
  mc: McResult;
  curve: ServiceCurvePoint[];
  dynamicRop: DynamicRopPoint[];
  policies: PolicyResult[];
  optimisation: Optimisation;
  tornado: Tornado;
  sweeps: { leadTime: SweepSeries; demand: SweepSeries; safetyStock: SweepSeries; fixedSS: number };
  simWeeks: number;
  /** Scenario-adjusted weekly demand forecast used by the simulator (warm-up weeks first). */
  demandPath: number[];
}

/** Professor's fixed safety stock in the original notebook. */
export const FIXED_SS = 200;
const FILL_PENALTY = 10_000_000;
const CAPACITY_PENALTY = 200;
const BUDGET_PENALTY = 2;

function windowMean(path: number[], start: number, L: number): number {
  const w = Math.max(1, Math.ceil(L));
  let s = 0;
  for (let k = 0; k < w; k++) s += path[Math.min(path.length - 1, start + k)];
  return s / w;
}

interface Ctx {
  path: number[];
  sigmaD: number;
  L: number;
  sigmaL: number;
  controls: Controls;
  unitPrice: number;
}

function drawsFor(c: Ctx, overrides: Partial<{ demandScale: number; sigmaD: number; L: number; sigmaL: number; h: number; p: number }> = {}): SimDraws {
  const scale = overrides.demandScale ?? 1;
  return generateDraws({
    demandMean: c.path.slice(0, SIM_WEEKS).map((v) => v * scale),
    sigmaD: overrides.sigmaD ?? c.sigmaD,
    L: overrides.L ?? c.L,
    sigmaL: overrides.sigmaL ?? c.sigmaL,
    holdingCost: overrides.h ?? c.controls.holdingCost,
    stockoutCost: overrides.p ?? c.controls.stockoutCost,
    orderCost: c.controls.orderCost,
  });
}

function makeObjective(draws: SimDraws, c: Ctx): Objective {
  return (s, Q) => {
    const r = simulate(draws, { s, Q });
    const { targetFillRate, capacity, budgetEnabled, budget } = c.controls;
    let penalty = 0;
    let feasible = true;
    if (r.fillRate < targetFillRate) {
      penalty += FILL_PENALTY * (targetFillRate - r.fillRate);
      feasible = false;
    }
    if (s + Q > capacity) {
      penalty += CAPACITY_PENALTY * (s + Q - capacity);
      feasible = false;
    }
    const value = r.avgOnHand * c.unitPrice;
    if (budgetEnabled && value > budget) {
      penalty += BUDGET_PENALTY * (value - budget);
      feasible = false;
    }
    return { objective: r.annualCost + penalty, feasible };
  };
}

/** Golden-section search for the cost-optimal reorder point at a fixed Q. */
function optimalS(draws: SimDraws, c: Ctx, Q: number, lo: number, hi: number): number {
  const f = makeObjective(draws, c);
  const g = (Math.sqrt(5) - 1) / 2;
  let a = lo;
  let b = hi;
  let x1 = b - g * (b - a);
  let x2 = a + g * (b - a);
  let f1 = f(Math.round(x1), Q).objective;
  let f2 = f(Math.round(x2), Q).objective;
  for (let i = 0; i < 22 && b - a > 1; i++) {
    if (f1 <= f2) {
      b = x2;
      x2 = x1;
      f2 = f1;
      x1 = b - g * (b - a);
      f1 = f(Math.round(x1), Q).objective;
    } else {
      a = x1;
      x1 = x2;
      f1 = f2;
      x2 = a + g * (b - a);
      f2 = f(Math.round(x2), Q).objective;
    }
  }
  return Math.round((a + b) / 2);
}

export function runEngine(input: EngineInput): EngineResult {
  const { controls, scenario } = input;
  const path = input.forecastMean.map((v) => v * scenario.demandMult);
  const sigmaD = input.sigmaD * scenario.sigmaDMult;
  const L = controls.leadTime * scenario.leadTimeMult;
  const sigmaL = controls.leadTimeSd * scenario.leadTimeSdMult;
  const recent = input.history.slice(-52);
  const dHist = mean(recent);
  const sigmaRaw = sd(recent);
  const z = zFor(controls.serviceLevel);
  const dBar = windowMean(path, 0, L);
  const dYear = mean(path.slice(0, 52));
  const Qeoq = Math.max(1, Math.round(eoq(dYear, controls.orderCost, controls.holdingCost)));
  const ctx: Ctx = { path, sigmaD, L, sigmaL, controls, unitPrice: input.unitPrice };

  // Safety stock: slide formula (forecast-driven) and the professor's baselines.
  const ssFormula = safetyStockSlide({ z, sigmaD, L, dBar, sigmaL });
  const ssStatic = safetyStockStatic(z, sigmaRaw, L);
  const ropFormula = dBar * L + ssFormula;
  const ropStatic = dHist * L + ssStatic;
  const ropFixed = dHist * L + FIXED_SS;

  // Monte Carlo lead-time demand.
  const mc = runMonteCarlo({ dBar, sigmaD, L, sigmaL, serviceLevel: controls.serviceLevel, orderQty: Qeoq });
  const curve = serviceCurve(mc.ltd, { dBar, sigmaD, L, sigmaL, sigmaRaw, holdingCost: controls.holdingCost });

  // Dynamic (adaptive) reorder point: recomputed each week from the forecast over its lead-time window.
  const dynamicRop: DynamicRopPoint[] = Array.from({ length: SIM_WEEKS }, (_, t) => {
    const d = windowMean(path, t, L);
    const ss = safetyStockSlide({ z, sigmaD, L, dBar: d, sigmaL });
    return { week: t + 1, dBar: d, ss, rop: d * L + ss };
  });

  // Shared simulator draws (common random numbers) for every policy and optimiser.
  const draws = drawsFor(ctx);
  const objective = makeObjective(draws, ctx);

  // Optimisation box centred on the analytic solutions: wide enough to contain clearly
  // infeasible and clearly overstocked policies, narrow enough for a 40-evaluation budget.
  const peakRop = Math.max(...dynamicRop.map((d) => d.rop));
  const box: Box = {
    sMin: Math.max(0, Math.round(0.7 * Math.min(ropFormula, ropStatic, dYear * L))),
    sMax: Math.max(10, Math.round(1.3 * Math.max(mc.ropMC, peakRop))),
    qMin: Math.max(1, Math.round(0.4 * Qeoq)),
    qMax: Math.max(10, Math.round(2.2 * Qeoq)),
  };
  const gridS = linspace(box.sMin, box.sMax, 20);
  const gridQ = linspace(box.qMin, box.qMax, 20);
  const heat: HeatCell[][] = gridQ.map((Q) =>
    gridS.map((s) => {
      const r = simulate(draws, { s, Q });
      const o = objective(s, Q);
      return { s, Q, cost: r.annualCost, objective: o.objective, fillRate: r.fillRate, feasible: o.feasible };
    }),
  );
  const fullGridBest = bestOf(heat.flat());
  // Both searches start from the same two analytic policies, then spend the rest of the budget.
  const warmStarts: [number, number][] = [
    [Math.min(box.sMax, Math.max(box.sMin, ropFormula)), Qeoq],
    [Math.min(box.sMax, Math.max(box.sMin, mc.ropMC)), Qeoq],
  ];
  const bo = bayesianOptimise(objective, box, gridS, gridQ, BO_BUDGET, OPT_SEED, warmStarts);
  const random = randomSearch(objective, box, BO_BUDGET, OPT_SEED, warmStarts);
  const manual = gridSearch(objective, linspace(box.sMin, box.sMax, 7), linspace(box.qMin, box.qMax, 6));
  const optimisation: Optimisation = {
    box,
    gridS,
    gridQ,
    heat,
    bo,
    random,
    manual,
    fullGridBest,
    gapPct: (bo.best.objective / fullGridBest.objective - 1) * 100,
  };

  // Policy comparison on the same draws.
  const policyDefs: { key: PolicyKey; name: string; kind: "baseline" | "ai"; s: number | number[]; Q: number }[] = [
    { key: "fixed", name: "Baseline: fixed SS = 200", kind: "baseline", s: Math.round(ropFixed), Q: Qeoq },
    { key: "static", name: "Baseline: static SS (Z x sigma x sqrt L)", kind: "baseline", s: Math.round(ropStatic), Q: Qeoq },
    { key: "dynamic", name: "AI: forecast-driven dynamic SS", kind: "ai", s: dynamicRop.map((d) => Math.round(d.rop)), Q: Qeoq },
    { key: "monteCarlo", name: "AI: Monte Carlo ROP", kind: "ai", s: Math.round(mc.ropMC), Q: Qeoq },
    { key: "bayes", name: "AI: Bayesian-optimised (s, Q)", kind: "ai", s: bo.best.s, Q: bo.best.Q },
  ];
  const policies: PolicyResult[] = policyDefs.map((p) => {
    const trace: TraceWeek[] = [];
    const sim = simulate(draws, { s: p.s, Q: p.Q }, trace);
    const s0 = typeof p.s === "number" ? p.s : p.s[0];
    return {
      key: p.key,
      name: p.name,
      kind: p.kind,
      s: s0,
      sMax: sim.maxS,
      Q: p.Q,
      sim,
      targetMet: sim.fillRate >= controls.targetFillRate,
      capacityOk: sim.maxS + p.Q <= controls.capacity,
      trace: trace.filter((w) => w.week >= 1),
    };
  });

  // Tornado: +/-20% one at a time; formula ROP and cost-optimal s at the optimised Q.
  const Qstar = bo.best.Q;
  const baseRopOpt = optimalS(draws, ctx, Qstar, box.sMin, box.sMax);
  const formulaRop = (o: Partial<{ dBar: number; sigmaD: number; L: number; sigmaL: number }>): number => {
    const d = o.dBar ?? dBar;
    const l = o.L ?? L;
    return d * l + safetyStockSlide({ z, sigmaD: o.sigmaD ?? sigmaD, L: l, dBar: d, sigmaL: o.sigmaL ?? sigmaL });
  };
  const specs: { key: TornadoBar["key"]; label: string; base: number; unit: string }[] = [
    { key: "dBar", label: "Average demand (Dbar)", base: dBar, unit: "units/wk" },
    { key: "sigmaD", label: "Demand variability (sigma_D)", base: sigmaD, unit: "units/wk" },
    { key: "L", label: "Lead time (L)", base: L, unit: "wk" },
    { key: "sigmaL", label: "Lead-time variability (sigma_L)", base: sigmaL, unit: "wk" },
    { key: "h", label: "Holding cost (h)", base: controls.holdingCost, unit: "per unit-wk" },
    { key: "p", label: "Stockout cost (p)", base: controls.stockoutCost, unit: "per unit" },
  ];
  const bars: TornadoBar[] = specs.map((sp) => {
    const res = [0.8, 1.2].map((m) => {
      const v = sp.base * m;
      const over =
        sp.key === "dBar"
          ? { demandScale: m }
          : sp.key === "sigmaD"
            ? { sigmaD: v }
            : sp.key === "L"
              ? { L: v }
              : sp.key === "sigmaL"
                ? { sigmaL: v }
                : sp.key === "h"
                  ? { h: v }
                  : { p: v };
      const rf = sp.key === "h" || sp.key === "p" ? ropFormula : formulaRop({ [sp.key]: v });
      const hi = Math.round(box.sMax * (sp.key === "dBar" || sp.key === "L" ? 1.2 : 1.05));
      const ro = optimalS(drawsFor(ctx, over), ctx, Qstar, box.sMin, hi);
      return { rf, ro };
    });
    return {
      key: sp.key,
      label: sp.label,
      baseValue: sp.base,
      unit: sp.unit,
      ropFormulaLow: res[0].rf,
      ropFormulaHigh: res[1].rf,
      ropOptLow: res[0].ro,
      ropOptHigh: res[1].ro,
    };
  });

  // Professor's one-at-a-time sweeps, applied to the current SKU in weekly units.
  const sweepL = Array.from({ length: 10 }, (_, i) => i + 1);
  const sweepD = Array.from({ length: 11 }, (_, i) => Math.round(dHist * (0.5 + i * 0.1)));
  const sweepSS = Array.from({ length: 7 }, (_, i) => i * 50);
  const sweeps = {
    fixedSS: FIXED_SS,
    leadTime: { x: sweepL, rop: sweepL.map((l) => dHist * l + FIXED_SS) },
    demand: { x: sweepD, rop: sweepD.map((d) => d * L + FIXED_SS) },
    safetyStock: { x: sweepSS, rop: sweepSS.map((s) => dHist * L + s) },
  };

  return {
    effective: { L, sigmaL, sigmaD, dBar, dHist, sigmaRaw, z, eoq: Qeoq, dYear },
    ss: { formula: ssFormula, ropFormula, static: ssStatic, ropStatic, ropFixed, shares: varianceShares(sigmaD, L, dBar, sigmaL) },
    mc,
    curve,
    dynamicRop,
    policies,
    optimisation,
    tornado: { baseRopFormula: ropFormula, baseRopOpt, Q: Qstar, bars },
    sweeps,
    simWeeks: SIM_WEEKS - SIM_WARMUP,
    demandPath: path.slice(0, SIM_WEEKS),
  };
}
