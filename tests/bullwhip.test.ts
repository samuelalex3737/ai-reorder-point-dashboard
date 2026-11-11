import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allocate } from "../src/lib/bullwhip/allocation";
import { DEFAULT_SHOCK, defaultBullwhipConfig, runLab } from "../src/lib/bullwhip/lab";
import { cheapestAssignment } from "../src/lib/bullwhip/simulate";
import { Rng } from "../src/lib/rng";
import type { BullwhipFile } from "../src/lib/types";

const data = JSON.parse(readFileSync(resolve(__dirname, "../public/data/bullwhip.json"), "utf8")) as BullwhipFile;
const lab = runLab({ data, holdoutWeeks: 26, config: defaultBullwhipConfig(), shock: DEFAULT_SHOCK });

describe("bullwhip simulation", () => {
  it("baseline: amplification above 1 and growing upstream, from ordering behaviour alone", () => {
    const s = lab.runs.baseline.stages;
    expect(s.retailer.bullwhip).toBeGreaterThan(1);
    expect(s.distributor.bullwhip).toBeGreaterThan(s.retailer.bullwhip);
    expect(s.manufacturer.bullwhip).toBeGreaterThan(s.distributor.bullwhip);
  });

  it("every run uses the same customer demand", () => {
    expect(lab.runs.aiForecast.customerDemand).toEqual(lab.runs.baseline.customerDemand);
    expect(lab.runs.aiRouting.customerDemand).toEqual(lab.runs.baseline.customerDemand);
  });

  it("information sharing with AI forecasting reduces upstream amplification", () => {
    const base = lab.runs.baseline.stages;
    const ai = lab.runs.aiForecast.stages;
    expect(ai.manufacturer.bullwhip).toBeLessThan(base.manufacturer.bullwhip);
    expect(ai.distributor.bullwhip).toBeLessThan(base.distributor.bullwhip);
    const noShare = runLab({ data, holdoutWeeks: 26, config: { ...defaultBullwhipConfig(), infoSharing: false }, shock: DEFAULT_SHOCK });
    expect(ai.manufacturer.bullwhip).toBeLessThan(noShare.runs.aiForecast.stages.manufacturer.bullwhip);
  });

  it("the advantage holds under a demand shock", () => {
    const shocked = runLab({ data, holdoutWeeks: 26, config: defaultBullwhipConfig(), shock: { ...DEFAULT_SHOCK, enabled: true } });
    expect(shocked.runs.baseline.stages.manufacturer.bullwhip).toBeGreaterThan(lab.runs.baseline.stages.manufacturer.bullwhip);
    expect(shocked.runs.aiRouting.stages.manufacturer.bullwhip).toBeLessThan(shocked.runs.baseline.stages.manufacturer.bullwhip);
    expect(shocked.shockWeeks).not.toBeNull();
  });

  it("reports cost consistently: stage totals add up and holding cost matches average inventory", () => {
    const cfg = defaultBullwhipConfig();
    for (const run of Object.values(lab.runs)) {
      const st = run.stages;
      expect(st.retailer.totalCost + st.distributor.totalCost + st.manufacturer.totalCost).toBeCloseTo(run.totalCost, 6);
      for (const k of ["retailer", "distributor", "manufacturer"] as const) {
        const m = st[k];
        expect(m.holdingCost + m.backlogCost + m.shippingCost).toBeCloseTo(m.totalCost, 6);
        expect(m.holdingCost).toBeCloseTo(cfg[k].holding * m.avgInventory * (run.weeks - run.warmup), 4);
        expect(m.fillRate).toBeGreaterThanOrEqual(0);
        expect(m.fillRate).toBeLessThanOrEqual(1 + 1e-12);
      }
      // Shipping cost equals lane volume times lane cost.
      let ship = 0;
      run.laneVolume.forEach((row, d) => row.forEach((v, r) => (ship += v * cfg.laneCost[d][r])));
      expect(st.distributor.shippingCost).toBeCloseTo(ship, 6);
    }
  });

  it("fixed routing only uses legacy lanes; AI routing moves retailers to cheaper lanes", () => {
    const cfg = defaultBullwhipConfig();
    const fixed = lab.runs.aiForecast.laneVolume;
    fixed.forEach((row, d) => row.forEach((v, r) => (cfg.assign[r] === d ? null : expect(v).toBe(0))));
    expect(cheapestAssignment(cfg.laneCost, cfg.assign)).toEqual([0, 1, 1]);
    expect(lab.runs.aiRouting.stages.distributor.shippingCost).toBeLessThan(lab.runs.aiForecast.stages.distributor.shippingCost);
  });

  it("is deterministic", () => {
    const again = runLab({ data, holdoutWeeks: 26, config: defaultBullwhipConfig(), shock: DEFAULT_SHOCK });
    expect(again.runs.aiRouting.totalCost).toBe(lab.runs.aiRouting.totalCost);
  });
});

describe("min-cost allocation", () => {
  it("never ships more than a distributor holds or a retailer needs, and never on a closed lane", () => {
    const rng = new Rng(17);
    for (let k = 0; k < 200; k++) {
      const stock = [rng.next() * 500, rng.next() * 500];
      const need = [rng.next() * 400, rng.next() * 400, rng.next() * 400];
      const laneCost = [
        [rng.next() * 2, rng.next() * 2, k % 3 === 0 ? Infinity : rng.next() * 2],
        [rng.next() * 2, rng.next() * 2, rng.next() * 2],
      ];
      const res = allocate({ stock, need, laneCost, backlogCost: need.map(() => 1 + rng.next() * 3), holdingCost: [0.5, 0.5] });
      res.ship.forEach((row, d) => expect(row.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(stock[d] + 1e-6));
      need.forEach((n, r) => expect(res.ship[0][r] + res.ship[1][r]).toBeLessThanOrEqual(n + 1e-6));
      res.ship.flat().forEach((v) => expect(v).toBeGreaterThanOrEqual(-1e-9));
      if (k % 3 === 0) expect(res.ship[0][2]).toBe(0);
    }
  });

  it("finds the optimum: no random feasible plan is cheaper", () => {
    const rng = new Rng(3);
    const inp = {
      stock: [300, 120],
      need: [200, 180, 90],
      laneCost: [
        [0.5, 0.9, 1.6],
        [1.4, 0.5, 0.4],
      ],
      backlogCost: [3, 2.5, 2],
      holdingCost: [0.6, 0.6],
    };
    const best = allocate(inp);
    const costOf = (x: number[][]): number => {
      let c = 0;
      for (let d = 0; d < 2; d++) {
        const out = x[d].reduce((a, b) => a + b, 0);
        c += inp.holdingCost[d] * (inp.stock[d] - out);
        for (let r = 0; r < 3; r++) c += inp.laneCost[d][r] * x[d][r];
      }
      for (let r = 0; r < 3; r++) c += inp.backlogCost[r] * (inp.need[r] - x[0][r] - x[1][r]);
      return c;
    };
    expect(costOf(best.ship)).toBeCloseTo(best.cost, 6);
    for (let k = 0; k < 5000; k++) {
      // Random feasible plan: scale random shares to respect stock and need.
      const x = [0, 1].map(() => [0, 1, 2].map(() => rng.next()));
      for (let d = 0; d < 2; d++) {
        const s = x[d].reduce((a, b) => a + b, 0);
        x[d] = x[d].map((v) => (v / s) * inp.stock[d] * rng.next());
      }
      for (let r = 0; r < 3; r++) {
        const got = x[0][r] + x[1][r];
        if (got > inp.need[r]) {
          x[0][r] *= inp.need[r] / got;
          x[1][r] *= inp.need[r] / got;
        }
      }
      expect(costOf(x)).toBeGreaterThanOrEqual(best.cost - 1e-6);
    }
  });
});
