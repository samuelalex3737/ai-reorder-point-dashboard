import { describe, expect, it } from "vitest";
import { parseCsv, promoLiftPerDay, simulateNextWeek, validateManual } from "../src/lib/data/intake";
import { initialRows, loadDataset } from "./helpers";

const data = loadDataset();
const sku = data.skus[0];
const history = initialRows(sku, data);
const ctx = { history, basePrice: sku.basePrice, store: sku.store, item: sku.item };
const last = history[history.length - 1].week; // 2023-06-26

describe("CSV intake validation", () => {
  it("accepts weekly rows that continue the history, with extra numeric columns", () => {
    const csv = `week,demand,promo_days,price,temperature\n2023-07-03,430,1,23.5,31\n2023-07-10,420,0,24.01,32\n`;
    const r = parseCsv(csv, ctx);
    expect(r.format).toBe("weekly");
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ week: "2023-07-03", demand: 430, promoDays: 1, extra: { temperature: 31 } });
    expect(r.issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(last).toBe("2023-06-26");
  });

  it("rejects gaps, duplicates, negatives and weeks already in the history", () => {
    expect(parseCsv("week,demand\n2023-07-10,400\n", ctx).rows).toHaveLength(0);
    expect(parseCsv("week,demand\n2023-07-03,400\n2023-07-03,410\n", ctx).issues.some((i) => /more than once/.test(i.message))).toBe(true);
    expect(parseCsv("week,demand\n2023-07-03,-5\n", ctx).rows).toHaveLength(0);
    expect(parseCsv("week,demand\n2023-06-26,400\n", ctx).issues.some((i) => /already in the history/.test(i.message))).toBe(true);
    expect(parseCsv("week,demand,promo_days\n2023-07-03,400,9\n", ctx).rows).toHaveLength(0);
    expect(parseCsv("foo,bar\n1,2\n", ctx).format).toBe("unknown");
  });

  it("aligns a non-Monday date to its week and warns about outliers", () => {
    const r = parseCsv("week,demand\n2023-07-05,5000\n", ctx);
    expect(r.rows[0].week).toBe("2023-07-03");
    expect(r.issues.some((i) => i.level === "warning" && /not a Monday/.test(i.message))).toBe(true);
    expect(r.issues.some((i) => i.level === "warning" && /far from the recent median/.test(i.message))).toBe(true);
  });

  it("aggregates Kaggle-style daily rows into full weeks and ignores other series", () => {
    const days = ["2023-07-03", "2023-07-04", "2023-07-05", "2023-07-06", "2023-07-07", "2023-07-08", "2023-07-09"];
    const lines = days.map((d, i) => `${d},${sku.store},${sku.item},60,${i === 2 ? 19.21 : 24.01},${i === 2 ? 1 : 0}`);
    lines.push(`2023-07-03,store_99,${sku.item},5,10,0`);
    lines.push(`2023-07-10,${sku.store},${sku.item},60,24.01,0`);
    const r = parseCsv(`date,store_id,item_id,sales,price,promo\n${lines.join("\n")}\n`, ctx);
    expect(r.format).toBe("daily");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ week: "2023-07-03", demand: 420, promoDays: 1 });
    expect(r.issues.some((i) => /other store\/item/.test(i.message))).toBe(true);
    expect(r.issues.some((i) => /1 of 7 days/.test(i.message))).toBe(true);
  });

  it("validates manual entry", () => {
    expect(validateManual({ demand: 410, promoDays: 2, price: 22 }, ctx).rows[0].week).toBe("2023-07-03");
    expect(validateManual({ demand: Number.NaN, promoDays: 0, price: 22 }, ctx).rows).toHaveLength(0);
  });
});

describe("stream simulator", () => {
  it("estimates a positive promotion lift and simulates a reproducible next week", () => {
    expect(promoLiftPerDay(history)).toBeGreaterThan(0.03);
    const a = simulateNextWeek(history, 400, 0.7, [5, -3, 8], sku.basePrice, 0.2);
    const b = simulateNextWeek(history, 400, 0.7, [5, -3, 8], sku.basePrice, 0.2);
    expect(a).toEqual(b);
    expect(a.week).toBe("2023-07-03");
    expect(a.source).toBe("stream-sim");
    expect(a.demand).toBeGreaterThan(0);
  });
});
