import type { SkuMeta } from "../types";

/**
 * The three representative SKUs (selection justified in docs/IMPLEMENTATION_PLAN.md).
 * Lead time and holding cost reuse the professor's Products A/B/C; lead-time variability,
 * stockout and ordering costs come from the reference engine; capacity is scaled to volume.
 */
export const SKU_CATALOGUE: SkuMeta[] = [
  {
    id: "A",
    label: "SKU A - Fast mover",
    description: "Highest-volume series in the dataset (about 400 units/week) with frequent promotions.",
    store: "store_2",
    item: "item_20",
    defaults: { leadTime: 2, leadTimeSd: 0.5, holdingCost: 1.1, stockoutCost: 15, orderCost: 1500, capacity: 4000 },
  },
  {
    id: "B",
    label: "SKU B - Typical",
    description: "The dataset median on every statistic (about 200 units/week).",
    store: "store_26",
    item: "item_11",
    defaults: { leadTime: 3, leadTimeSd: 0.8, holdingCost: 1.3, stockoutCost: 18, orderCost: 2000, capacity: 3000 },
  },
  {
    id: "C",
    label: "SKU C - Slow mover",
    description: "Slow mover (about 70 units/week) with the highest relative noise and strongest seasonality.",
    store: "store_43",
    item: "item_23",
    defaults: { leadTime: 4, leadTimeSd: 1.2, holdingCost: 1.8, stockoutCost: 25, orderCost: 1200, capacity: 1500 },
  },
];

/**
 * Bullwhip Lab retailers: the same product as SKU A (item_20) at three stores of clearly
 * different volume, so the distributor network is unbalanced and routing decisions matter.
 * The dataset has no city or cluster field, so volume is the selection criterion.
 */
export const BULLWHIP_ITEM = "item_20";
export const BULLWHIP_RETAILERS = [
  { id: "R1", store: "store_2", label: "Retailer 1 (store_2)" },
  { id: "R2", store: "store_9", label: "Retailer 2 (store_9)" },
  { id: "R3", store: "store_30", label: "Retailer 3 (store_30)" },
] as const;
