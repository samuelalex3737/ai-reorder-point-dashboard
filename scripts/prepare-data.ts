/**
 * Offline data preparation (run once): streams the raw Kaggle file and writes the
 * weekly extract for the three dashboard SKUs to public/data/skus.json.
 *
 * Source: Talukdar, D. Store Item Demand Forecasting Dataset, Kaggle, MIT licence.
 * The raw 195 MB file is never committed or deployed; only weekly totals for three
 * store-item series are published.
 *
 * Usage: npm run prepare-data [-- path/to/retail_sales.csv]
 */
import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BULLWHIP_ITEM, BULLWHIP_RETAILERS, SKU_CATALOGUE } from "../src/lib/data/catalogue";
import type { BullwhipFile, DatasetFile, SkuSeries, WeekRow } from "../src/lib/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const csvPath = resolve(process.argv[2] ?? resolve(root, "archive/retail_sales.csv"));
const outPath = resolve(root, "public/data/skus.json");
const bullwhipPath = resolve(root, "public/data/bullwhip.json");

/** First full Monday-Sunday week. 2019-01-01 is a Tuesday, so the partial first week is dropped. */
const FIRST_MONDAY = Date.UTC(2019, 0, 7);
const DAY_MS = 86_400_000;

interface Acc {
  demand: number;
  promoDays: number;
  priceSum: number;
  days: number;
}

async function main(): Promise<void> {
  const wanted = new Map<string, string[]>();
  const want = (key: string, id: string) => wanted.set(key, [...(wanted.get(key) ?? []), id]);
  for (const s of SKU_CATALOGUE) want(`${s.store}|${s.item}`, s.id);
  for (const r of BULLWHIP_RETAILERS) want(`${r.store}|${BULLWHIP_ITEM}`, r.id);
  const acc = new Map<string, Map<number, Acc>>();
  const basePrice = new Map<string, number>();
  for (const id of [...SKU_CATALOGUE.map((s) => s.id), ...BULLWHIP_RETAILERS.map((r) => r.id)]) acc.set(id, new Map());

  const rl = createInterface({ input: createReadStream(csvPath), crlfDelay: Infinity });
  let header: string[] | null = null;
  let lines = 0;
  for await (const line of rl) {
    if (!header) {
      header = line.split(",");
      const expected = ["date", "store_id", "item_id", "sales", "price", "promo", "weekday", "month"];
      if (header.join(",") !== expected.join(",")) {
        throw new Error(`Unexpected header: ${header.join(",")}`);
      }
      continue;
    }
    lines++;
    const [date, store, item, sales, price, promo] = line.split(",");
    const ids = wanted.get(`${store}|${item}`);
    if (!ids) continue;
    const t = Date.parse(`${date}T00:00:00Z`);
    if (t < FIRST_MONDAY) continue;
    const w = Math.floor((t - FIRST_MONDAY) / (7 * DAY_MS));
    for (const id of ids) {
      const series = acc.get(id)!;
      const a = series.get(w) ?? { demand: 0, promoDays: 0, priceSum: 0, days: 0 };
      a.demand += Number(sales);
      a.promoDays += Number(promo);
      a.priceSum += Number(price);
      a.days += 1;
      series.set(w, a);
      if (promo === "0") basePrice.set(id, Number(price));
    }
  }

  const weeklyRows = (id: string): WeekRow[] => {
    const series = acc.get(id)!;
    const weeks = [...series.keys()].sort((a, b) => a - b);
    return weeks.map((w) => {
      const a = series.get(w)!;
      if (a.days !== 7) throw new Error(`${id} week ${w} has ${a.days} days`);
      return {
        week: new Date(FIRST_MONDAY + w * 7 * DAY_MS).toISOString().slice(0, 10),
        demand: a.demand,
        promoDays: a.promoDays,
        price: Math.round((a.priceSum / a.days) * 100) / 100,
        source: "dataset",
      };
    });
  };
  const skus: SkuSeries[] = SKU_CATALOGUE.map((meta) => ({ ...meta, basePrice: basePrice.get(meta.id)!, rows: weeklyRows(meta.id) }));
  const bullwhip: BullwhipFile = {
    item: BULLWHIP_ITEM,
    retailers: BULLWHIP_RETAILERS.map((r) => ({ id: r.id, store: r.store, label: r.label, basePrice: basePrice.get(r.id)!, rows: weeklyRows(r.id) })),
  };
  writeFileSync(bullwhipPath, JSON.stringify(bullwhip));
  for (const r of bullwhip.retailers) {
    const mean = r.rows.reduce((x, y) => x + y.demand, 0) / r.rows.length;
    process.stdout.write(`${r.id} ${r.store}/${BULLWHIP_ITEM}: ${r.rows.length} weeks, mean ${mean.toFixed(1)}
`);
  }

  const out: DatasetFile = {
    source: {
      title: "Store Item Demand Forecasting Dataset",
      author: "Dhrubang Talukdar",
      url: "https://www.kaggle.com/datasets/dhrubangtalukdar/store-item-demand-forecasting-dataset",
      licence: "MIT",
      note: "Daily store-item sales aggregated to Monday-Sunday weeks (2019-01-07 to 2023-12-31). Synthetic data.",
    },
    rawRows: lines,
    holdoutWeeks: 26,
    skus,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  for (const s of skus) {
    const d = s.rows.map((r) => r.demand);
    const mean = d.reduce((x, y) => x + y, 0) / d.length;
    process.stdout.write(
      `${s.id} ${s.store}/${s.item}: ${s.rows.length} weeks ${s.rows[0].week} to ${s.rows.at(-1)!.week}, mean ${mean.toFixed(1)}, base price ${s.basePrice}\n`,
    );
  }
  process.stdout.write(`raw rows read: ${lines}; wrote ${outPath}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
