import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DatasetFile, SkuSeries, WeekRow } from "../src/lib/types";

export function loadDataset(): DatasetFile {
  return JSON.parse(readFileSync(resolve(__dirname, "../public/data/skus.json"), "utf8")) as DatasetFile;
}

/** The history the dashboard opens with (held-back stream weeks removed). */
export function initialRows(sku: SkuSeries, data: DatasetFile): WeekRow[] {
  return sku.rows.slice(0, sku.rows.length - data.holdoutWeeks);
}
