/** Shared domain types. Time unit everywhere: weeks (demand in units per week). */

export type RowSource = "dataset" | "upload" | "manual" | "stream-real" | "stream-sim";

/** One week of demand history for one SKU. */
export interface WeekRow {
  /** ISO date (YYYY-MM-DD) of the Monday that starts the week. */
  week: string;
  /** Units demanded in the week. */
  demand: number;
  /** Number of promotion days in the week (0-7). Planned in advance, so known ahead of time. */
  promoDays: number;
  /** Average selling price in the week. */
  price: number;
  /** Optional external factors supplied by an upload (for example holiday, temperature). */
  extra?: Record<string, number>;
  source: RowSource;
}

/** Inventory policy defaults for a SKU (all editable live in the dashboard). */
export interface SkuPolicyDefaults {
  /** Mean replenishment lead time, weeks. */
  leadTime: number;
  /** Lead-time standard deviation, weeks. */
  leadTimeSd: number;
  /** Holding cost per unit per week. */
  holdingCost: number;
  /** Stockout (backorder) cost per unit short. */
  stockoutCost: number;
  /** Fixed cost per replenishment order. */
  orderCost: number;
  /** Storage capacity, units (constraint s + Q <= capacity). */
  capacity: number;
}

export interface SkuMeta {
  id: "A" | "B" | "C";
  label: string;
  description: string;
  store: string;
  item: string;
  defaults: SkuPolicyDefaults;
}

export interface SkuSeries extends SkuMeta {
  basePrice: number;
  rows: WeekRow[];
}

export interface DatasetFile {
  source: { title: string; author: string; url: string; licence: string; note: string };
  rawRows: number;
  /** The final N real weeks are held back and released by "Stream next period". */
  holdoutWeeks: number;
  skus: SkuSeries[];
}

/** Weekly demand for the Bullwhip Lab retailers (same item at three stores). */
export interface BullwhipFile {
  item: string;
  retailers: { id: string; store: string; label: string; basePrice: number; rows: WeekRow[] }[];
}
