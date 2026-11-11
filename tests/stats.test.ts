import { describe, expect, it } from "vitest";
import { drawLeadTime, Rng } from "../src/lib/rng";
import { mean, normCdf, normInv, normLoss, quantileSorted, sd } from "../src/lib/stats";
import { addWeeks, isoWeek, mondayOf } from "../src/lib/calendar";

describe("normal distribution", () => {
  it("inverse CDF matches published quantiles", () => {
    expect(normInv(0.95)).toBeCloseTo(1.644854, 5);
    expect(normInv(0.99)).toBeCloseTo(2.326348, 5);
    expect(normInv(0.8)).toBeCloseTo(0.841621, 5);
    expect(normInv(0.5)).toBeCloseTo(0, 8);
    expect(normInv(0.01)).toBeCloseTo(-2.326348, 5);
  });
  it("CDF inverts the inverse CDF", () => {
    for (const p of [0.001, 0.05, 0.3, 0.7, 0.95, 0.999]) expect(normCdf(normInv(p))).toBeCloseTo(p, 6);
  });
  it("loss function G(0) = 1/sqrt(2 pi)", () => {
    expect(normLoss(0)).toBeCloseTo(0.398942, 5);
  });
});

describe("seeded RNG", () => {
  it("is reproducible for a seed and differs across seeds", () => {
    const a = new Rng(7);
    const b = new Rng(7);
    const c = new Rng(8);
    const xa = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(xa);
    expect(c.next()).not.toEqual(xa[0]);
  });
  it("uniform and normal draws have the right moments", () => {
    const r = new Rng(1);
    const u = Array.from({ length: 100_000 }, () => r.next());
    expect(mean(u)).toBeCloseTo(0.5, 2);
    const z = Array.from({ length: 100_000 }, () => r.normal());
    expect(mean(z)).toBeCloseTo(0, 1);
    expect(sd(z)).toBeCloseTo(1, 1);
  });
  it("gamma lead times have mean L and sd sigma_L within 1%", () => {
    const r = new Rng(3);
    for (const [L, sL] of [
      [2, 0.5],
      [4, 1.2],
      [3, 2.5],
    ]) {
      const x = Array.from({ length: 200_000 }, () => drawLeadTime(r, L, sL));
      expect(Math.abs(mean(x) / L - 1)).toBeLessThan(0.01);
      expect(Math.abs(sd(x) / sL - 1)).toBeLessThan(0.01);
      expect(x.every((v) => v > 0)).toBe(true);
    }
    expect(drawLeadTime(r, 2, 0)).toBe(2);
  });
  it("quantile uses linear interpolation", () => {
    expect(quantileSorted([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantileSorted([0, 10], 0.25)).toBe(2.5);
  });
});

describe("calendar", () => {
  it("handles ISO weeks and Monday arithmetic", () => {
    expect(isoWeek("2019-01-07")).toBe(2);
    expect(isoWeek("2020-12-28")).toBe(53);
    expect(mondayOf("2023-12-31")).toBe("2023-12-25");
    expect(addWeeks("2023-12-25", 1)).toBe("2024-01-01");
  });
});
