import { describe, expect, it } from "vitest";
import { runEngine } from "../src/lib/engine/inventoryEngine";
import { defaultControls, FORECAST_HORIZON, futurePromoPlan, SCENARIOS } from "../src/lib/engine/params";
import { runPipeline } from "../src/lib/forecast/pipeline";
import { bayesianOptimise, bestOf, expectedImprovement, linspace, randomSearch } from "../src/lib/optim/bayesOpt";
import { GaussianProcess } from "../src/lib/optim/gp";
import { Rng } from "../src/lib/rng";
import { initialRows, loadDataset } from "./helpers";

describe("Gaussian process", () => {
  it("interpolates training points and is uncertain far from data", () => {
    const X = [
      [0.1, 0.1],
      [0.5, 0.5],
      [0.9, 0.2],
      [0.3, 0.8],
      [0.7, 0.9],
    ];
    const f = (x: number[]) => Math.sin(3 * x[0]) + x[1] ** 2;
    const gp = new GaussianProcess().fit(X, X.map(f));
    for (const x of X) expect(gp.predict(x).mean).toBeCloseTo(f(x), 1);
    expect(gp.predict([0.5, 0.5]).sd).toBeLessThan(gp.predict([0.0, 1.0]).sd);
  });
});

describe("Expected Improvement", () => {
  it("is non-negative, zero at the incumbent with no uncertainty, and grows with uncertainty", () => {
    expect(expectedImprovement(1, 0, 1, 0)).toBe(0);
    expect(expectedImprovement(2, 0.5, 1)).toBeGreaterThanOrEqual(0);
    expect(expectedImprovement(1, 1, 1)).toBeGreaterThan(expectedImprovement(1, 0.1, 1));
  });
});

describe("Bayesian optimisation", () => {
  const box = { sMin: 0, sMax: 1000, qMin: 1, qMax: 1000 };
  const bowl = (s: number, Q: number) => ({ objective: 100 + ((s - 620) / 100) ** 2 + ((Q - 310) / 100) ** 2, feasible: true });

  it("finds the minimum of a known bowl and beats random search with the same budget and seed", () => {
    const g = linspace(0, 1000, 20);
    const bo = bayesianOptimise(bowl, box, g, g, 40, 42);
    const rs = randomSearch(bowl, box, 40, 42);
    expect(bo.evaluations).toHaveLength(40);
    expect(Math.abs(bo.best.s - 620)).toBeLessThan(60);
    expect(Math.abs(bo.best.Q - 310)).toBeLessThan(60);
    expect(bo.best.objective).toBeLessThanOrEqual(rs.at(-1)!.bestSoFar);
    for (let i = 1; i < bo.evaluations.length; i++) expect(bo.evaluations[i].bestSoFar).toBeLessThanOrEqual(bo.evaluations[i - 1].bestSoFar);
  });

  it("prefers feasible points", () => {
    const best = bestOf([
      { objective: 1, feasible: false },
      { objective: 5, feasible: true },
    ]);
    expect(best.objective).toBe(5);
  });

  it("is reproducible with the same seed", () => {
    const g = linspace(0, 1000, 5);
    const a = bayesianOptimise(bowl, box, g, g, 15, 9);
    const b = bayesianOptimise(bowl, box, g, g, 15, 9);
    expect(b.evaluations.map((e) => [e.s, e.Q])).toEqual(a.evaluations.map((e) => [e.s, e.Q]));
  });

  it("random search draws inside the box", () => {
    const r = randomSearch(bowl, box, 30, new Rng(1).int(1000));
    for (const e of r) {
      expect(e.s).toBeGreaterThanOrEqual(0);
      expect(e.s).toBeLessThanOrEqual(1000);
    }
  });
});

describe("inventory engine (end to end)", () => {
  const data = loadDataset();
  const sku = data.skus[0];
  const rows = initialRows(sku, data);
  const promoRate = rows.reduce((a, r) => a + r.promoDays, 0) / rows.length;
  const fc = runPipeline({ rows, basePrice: sku.basePrice, futurePromo: futurePromoPlan(SCENARIOS.normal, promoRate, FORECAST_HORIZON), lstm: null });
  const controls = defaultControls(sku.defaults);
  const res = runEngine({ forecastMean: fc.forecast.map((f) => f.mean), sigmaD: fc.sigmaD, history: rows.map((r) => r.demand), unitPrice: sku.basePrice, controls, scenario: SCENARIOS.normal });

  it("uses the forecast-error sigma and the lead-time window mean in the slide formula", () => {
    expect(res.effective.sigmaD).toBeCloseTo(fc.sigmaD, 10);
    const window = fc.forecast.slice(0, Math.ceil(controls.leadTime)).map((f) => f.mean);
    expect(res.effective.dBar).toBeCloseTo(window.reduce((a, b) => a + b, 0) / window.length, 10);
    expect(res.ss.ropFormula).toBeCloseTo(res.effective.dBar * res.effective.L + res.ss.formula, 10);
  });

  it("evaluates five policies on the same simulator; BO meets the target and beats every feasible static policy", () => {
    expect(res.policies.map((p) => p.key)).toEqual(["fixed", "static", "dynamic", "monteCarlo", "bayes"]);
    const bayes = res.policies.find((p) => p.key === "bayes")!;
    expect(bayes.targetMet).toBe(true);
    expect(bayes.capacityOk).toBe(true);
    // A single (s, Q) policy is compared with the other single-ROP policies; the weekly dynamic
    // policy is a richer policy class and may legitimately do better under seasonality.
    const staticFeasible = res.policies.filter((x) => x.targetMet && x.capacityOk && x.key !== "dynamic" && x.key !== "bayes");
    for (const p of staticFeasible) expect(bayes.sim.annualCost).toBeLessThanOrEqual(p.sim.annualCost + 1e-6);
  });

  it("uses the same 40-evaluation budget for BO and random search and the 42-point manual grid", () => {
    expect(res.optimisation.bo.evaluations).toHaveLength(40);
    expect(res.optimisation.random).toHaveLength(40);
    expect(res.optimisation.manual).toHaveLength(42);
    expect(res.optimisation.heat).toHaveLength(20);
    expect(res.optimisation.heat[0]).toHaveLength(20);
    expect(res.optimisation.bo.best.objective).toBeLessThanOrEqual(res.optimisation.manual.at(-1)!.bestSoFar);
  });

  it("builds a six-factor tornado and a dynamic ROP path", () => {
    expect(res.tornado.bars.map((b) => b.key)).toEqual(["dBar", "sigmaD", "L", "sigmaL", "h", "p"]);
    const d = res.tornado.bars[0];
    expect(d.ropFormulaHigh).toBeGreaterThan(d.ropFormulaLow);
    expect(res.dynamicRop).toHaveLength(60);
    expect(new Set(res.dynamicRop.map((p) => Math.round(p.rop))).size).toBeGreaterThan(10);
  });
});
