import { describe, expect, it } from "vitest";
import { featureRow, MIN_HISTORY } from "../src/lib/forecast/features";
import { ensureBackend, LstmForecaster } from "../src/lib/forecast/lstm";
import { computeMetrics } from "../src/lib/forecast/metrics";
import { estimatePromoDiscount, runPipeline } from "../src/lib/forecast/pipeline";
import { RidgeRegression } from "../src/lib/forecast/ridge";
import { Rng } from "../src/lib/rng";
import { initialRows, loadDataset } from "./helpers";

describe("metrics", () => {
  it("match hand-worked values", () => {
    const m = computeMetrics([100, 200, 100], [110, 180, 100]);
    // errors (actual - forecast): -10, 20, 0
    expect(m.mape).toBeCloseTo(((0.1 + 0.1 + 0) / 3) * 100, 10);
    expect(m.wape).toBeCloseTo((30 / 400) * 100, 10);
    expect(m.rmse).toBeCloseTo(Math.sqrt(500 / 3), 10);
    expect(m.bias).toBeCloseTo((-10 / 400) * 100, 10);
  });
});

describe("features", () => {
  it("never read demand at or after the target week (leakage guard)", () => {
    const demand = Array.from({ length: 80 }, (_, i) => 100 + i);
    const t = 60;
    const poisoned = demand.map((v, i) => (i >= t ? Number.NaN : v));
    const exo = { week: "2020-03-02", promoDays: 2, price: 9 };
    const ctx = { basePrice: 10, extraKeys: [] };
    const row = featureRow(poisoned, t, exo, ctx);
    expect(row.every(Number.isFinite)).toBe(true);
    expect(row).toEqual(featureRow(demand, t, exo, ctx));
    expect(row[0]).toBe(demand[t - 1]);
    expect(row[4]).toBe(demand[t - 52]);
  });
  it("refuse to build rows without a year of history", () => {
    expect(() => featureRow([1, 2, 3], 3, { week: "2020-01-06", promoDays: 0, price: 1 }, { basePrice: 1, extraKeys: [] })).toThrow();
    expect(MIN_HISTORY).toBe(52);
  });
});

describe("ridge regression", () => {
  it("recovers a linear relationship", () => {
    const rng = new Rng(5);
    const X = Array.from({ length: 300 }, () => [rng.normal(), rng.normal(), rng.normal()]);
    const y = X.map((x) => 3 + 2 * x[0] - 1 * x[1] + 0.5 * x[2]);
    const m = new RidgeRegression(1e-8).fit(X, y);
    expect(m.predict([1, 1, 1])).toBeCloseTo(4.5, 4);
    expect(m.predict([0, 0, 0])).toBeCloseTo(3, 4);
  });
});

describe("forecast pipeline", () => {
  const data = loadDataset();
  const sku = data.skus[1];
  const rows = initialRows(sku, data);
  const promo = new Array(52).fill(0.7);

  it("evaluates out of sample: test-window values never influence earlier predictions", () => {
    const base = runPipeline({ rows, basePrice: sku.basePrice, futurePromo: promo, lstm: null });
    const shocked = rows.map((r, i) => (i === rows.length - 1 ? { ...r, demand: r.demand * 3 } : r));
    const alt = runPipeline({ rows: shocked, basePrice: sku.basePrice, futurePromo: promo, lstm: null });
    for (const m of base.models) {
      const other = alt.models.find((x) => x.key === m.key)!;
      // Every one-step prediction, including the shocked week's own, is unchanged.
      expect(other.testPred).toEqual(m.testPred);
    }
    expect(base.testStart).toBe(rows.length - 52);
    expect(base.testActual).toHaveLength(52);
  });

  it("selects the lowest-WAPE model and derives sigma_D from its out-of-sample errors", () => {
    const res = runPipeline({ rows, basePrice: sku.basePrice, futurePromo: promo, lstm: null });
    const best = res.models.find((m) => m.key === res.bestKey)!;
    for (const m of res.models) expect(best.metrics.wape).toBeLessThanOrEqual(m.metrics.wape);
    const resid = res.testActual.map((y, i) => y - best.testPred[i]);
    const mu = resid.reduce((a, b) => a + b, 0) / resid.length;
    const sdManual = Math.sqrt(resid.reduce((a, b) => a + (b - mu) ** 2, 0) / (resid.length - 1));
    expect(res.sigmaD).toBeCloseTo(sdManual, 10);
    // ML must beat the naive baseline on this strongly seasonal, promotion-driven data.
    const naive = res.models.find((m) => m.key === "naive")!;
    expect(best.metrics.wape).toBeLessThan(naive.metrics.wape);
    expect(res.forecast).toHaveLength(52);
    expect(res.forecast[0].lo80).toBeLessThan(res.forecast[0].mean);
    expect(res.forecast[51].hi95 - res.forecast[51].lo95).toBeGreaterThan(res.forecast[0].hi95 - res.forecast[0].lo95);
  });

  it("is deterministic", () => {
    const a = runPipeline({ rows, basePrice: sku.basePrice, futurePromo: promo, lstm: null });
    const b = runPipeline({ rows, basePrice: sku.basePrice, futurePromo: promo, lstm: null });
    expect(b.sigmaD).toBe(a.sigmaD);
    expect(b.forecast.map((f) => f.mean)).toEqual(a.forecast.map((f) => f.mean));
  });

  it("recovers the 20% promotional discount from prices", () => {
    expect(estimatePromoDiscount(rows, sku.basePrice)).toBeCloseTo(0.2, 2);
  });
});

describe("LSTM", () => {
  it("trains deterministically from a seed", async () => {
    await ensureBackend();
    const data = loadDataset();
    const rows = initialRows(data.skus[2], data).slice(0, 80);
    const demand = rows.map((r) => r.demand);
    const run = async () => {
      const net = new LstmForecaster(42);
      await net.train(demand, rows, 70, { epochs: 2, learningRate: 0.01 });
      const p = net.predict(demand, rows, 75);
      net.dispose();
      return p;
    };
    const p1 = await run();
    const p2 = await run();
    expect(p1).toBe(p2);
    expect(p1).toBeGreaterThan(0);
  });
});
