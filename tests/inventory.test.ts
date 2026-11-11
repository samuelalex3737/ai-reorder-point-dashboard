import { describe, expect, it } from "vitest";
import { exceedanceProb, expectedShortage, runMonteCarlo, sampleLtd, serviceCurve } from "../src/lib/inventory/monteCarlo";
import { eoq, reorderPointSlide, safetyStockSlide, safetyStockStatic, SERVICE_GRID, varianceShares, zFor } from "../src/lib/inventory/safetyStock";
import { generateDraws, simulate, type TraceWeek } from "../src/lib/inventory/simulator";
import { normInv } from "../src/lib/stats";

describe("safety stock formulas (unit-test fixture from the brief)", () => {
  const fixture = { z: 1.6449, sigmaD: 28, L: 2, dBar: 572, sigmaL: 0.5 };

  it("slide formula: SS = 474.9 and ROP = 1,618.9", () => {
    expect(safetyStockSlide(fixture)).toBeCloseTo(474.9, 1);
    expect(reorderPointSlide(fixture)).toBeCloseTo(1618.9, 1);
  });

  it("hand calculation: 1.6449 x sqrt(28^2 x 2 + 572^2 x 0.5^2)", () => {
    const hand = 1.6449 * Math.sqrt(784 * 2 + 327184 * 0.25);
    expect(safetyStockSlide(fixture)).toBe(hand);
  });

  it("professor's static formula: Z x 65 x sqrt(2) = 151.2", () => {
    expect(safetyStockStatic(1.6449, 65, 2)).toBeCloseTo(151.2, 1);
  });

  it("Z from a 95% cycle service level is 1.6449", () => {
    expect(zFor(0.95)).toBeCloseTo(1.6449, 4);
  });

  it("reduces to the static formula when lead time is certain", () => {
    expect(safetyStockSlide({ z: 2, sigmaD: 50, L: 4, dBar: 300, sigmaL: 0 })).toBeCloseTo(safetyStockStatic(2, 50, 4), 10);
  });

  it("splits lead-time-demand variance between demand and lead-time uncertainty", () => {
    const s = varianceShares(28, 2, 572, 0.5);
    expect(s.demand + s.leadTime).toBeCloseTo(1, 12);
    expect(s.leadTime).toBeCloseTo(81796 / 83364, 10);
  });

  it("EOQ = sqrt(2KD/h)", () => {
    expect(eoq(400, 1500, 1.1)).toBeCloseTo(Math.sqrt((2 * 1500 * 400) / 1.1), 10);
  });
});

describe("Monte Carlo lead-time demand", () => {
  it("matches the closed-form quantile when lead time is certain", () => {
    const r = runMonteCarlo({ dBar: 200, sigmaD: 30, L: 3, sigmaL: 0, serviceLevel: 0.95, orderQty: 800, draws: 200_000, seed: 11 });
    const exact = 200 * 3 + normInv(0.95) * 30 * Math.sqrt(3);
    expect(Math.abs(r.ropMC - exact) / exact).toBeLessThan(0.003);
    expect(r.ltdMean).toBeCloseTo(600, 0);
  });

  it("uses at least 10,000 draws by default and is reproducible", () => {
    const a = runMonteCarlo({ dBar: 400, sigmaD: 15, L: 2, sigmaL: 0.5, serviceLevel: 0.95, orderQty: 1000 });
    const b = runMonteCarlo({ dBar: 400, sigmaD: 15, L: 2, sigmaL: 0.5, serviceLevel: 0.95, orderQty: 1000 });
    expect(a.draws).toBeGreaterThanOrEqual(10_000);
    expect(a.ropMC).toBe(b.ropMC);
  });

  it("puts the ROP at the service-level quantile and lands above the normal approximation (gamma skew)", () => {
    const r = runMonteCarlo({ dBar: 400, sigmaD: 15, L: 2, sigmaL: 0.5, serviceLevel: 0.95, orderQty: 1000 });
    expect(exceedanceProb(r.ltd, r.ropMC)).toBeCloseTo(0.05, 2);
    expect(r.ropMC).toBeGreaterThan(r.ropFormula);
    expect(r.leadTimeMean).toBeCloseTo(2, 1);
    expect(r.histogram.reduce((a, b) => a + b.count, 0)).toBe(r.draws);
  });

  it("expected shortage and the service curve behave sensibly", () => {
    const { ltd } = sampleLtd({ dBar: 100, sigmaD: 10, L: 2, sigmaL: 0.3 });
    expect(expectedShortage(ltd, 0)).toBeCloseTo(ltd.reduce((a, b) => a + b, 0) / ltd.length, 6);
    const curve = serviceCurve(ltd, { dBar: 100, sigmaD: 10, L: 2, sigmaL: 0.3, sigmaRaw: 25, holdingCost: 2 });
    expect(curve).toHaveLength(SERVICE_GRID.length);
    expect(curve[0].serviceLevel).toBe(0.8);
    expect(curve.at(-1)!.serviceLevel).toBe(0.99);
    for (let i = 1; i < curve.length; i++) expect(curve[i].ssFormula).toBeGreaterThan(curve[i - 1].ssFormula);
    expect(curve[15].holdFormula).toBeCloseTo(curve[15].ssFormula * 2, 10);
  });
});

describe("inventory simulator", () => {
  const scenario = {
    demandMean: new Array(60).fill(100),
    sigmaD: 15,
    L: 2,
    sigmaL: 0.5,
    holdingCost: 1,
    stockoutCost: 10,
    orderCost: 500,
  };

  it("conserves stock week by week", () => {
    const draws = generateDraws(scenario);
    const trace: TraceWeek[] = [];
    simulate(draws, { s: 250, Q: 300 }, trace);
    for (let i = 1; i < trace.length; i++) {
      expect(trace[i].onHand).toBeCloseTo(trace[i - 1].onHand + trace[i].arrived - trace[i].demand, 9);
    }
    const ordered = trace.reduce((a, w) => a + w.ordered, 0);
    const arrived = trace.reduce((a, w) => a + w.arrived, 0);
    const pipeline = trace.at(-1)!.inventoryPosition - trace.at(-1)!.onHand;
    expect(ordered - arrived).toBeCloseTo(pipeline, 9);
  });

  it("uses common random numbers: same draws give identical results, cost splits add up", () => {
    const draws = generateDraws(scenario);
    const a = simulate(draws, { s: 260, Q: 320 });
    const b = simulate(draws, { s: 260, Q: 320 });
    expect(b).toEqual(a);
    expect(a.holding + a.shortage + a.ordering).toBeCloseTo(a.annualCost, 6);
    expect(a.fillRate).toBeGreaterThan(0);
    expect(a.fillRate).toBeLessThanOrEqual(1);
  });

  it("raises the fill rate and holding cost when the reorder point rises", () => {
    const draws = generateDraws(scenario);
    const low = simulate(draws, { s: 150, Q: 300 });
    const high = simulate(draws, { s: 350, Q: 300 });
    expect(high.fillRate).toBeGreaterThan(low.fillRate);
    expect(high.holding).toBeGreaterThan(low.holding);
    expect(high.weeklyStockoutProb).toBeLessThan(low.weeklyStockoutProb);
  });

  it("accepts a week-by-week (dynamic) reorder point", () => {
    const draws = generateDraws(scenario);
    const r = simulate(draws, { s: new Array(60).fill(260), Q: 320 });
    expect(r).toEqual(simulate(draws, { s: 260, Q: 320 }));
  });
});
