/**
 * Bullwhip Lab: a weekly multi-echelon simulation (Customers -> 3 Retailers -> 2 Distributors
 * -> 1 Manufacturer). Amplification is not hard-coded: it emerges from how each node forecasts
 * and orders (Lee, Padmanabhan and Whang, 1997).
 *
 * Week t, in order:
 *  1. Shipments and production due this week arrive.
 *  2. Retailers meet customer demand from stock; unmet demand is backlogged.
 *  3. Retailers forecast and place orders on the distributor tier (order-up-to policy).
 *  4. Distributors ship to retailers: fixed routing serves each retailer only from its assigned
 *     distributor, first come first served; AI routing solves a min-cost allocation across lanes.
 *  5. Distributors forecast and order from the manufacturer.
 *  6. The manufacturer ships to distributors (first come first served) and releases production.
 *
 * Forecasting modes
 *  - "naive": every node forecasts from the stream it observes (customer demand for retailers,
 *    incoming orders upstream) with a moving average, and sizes safety stock from the moving sd.
 *  - "ml": retailers use the best ML model's one-step forecast of their customer demand (made
 *    out of sample); with information sharing, upstream nodes plan on the shared
 *    customer-demand forecast instead of the orders arriving from downstream.
 */
import { allocate } from "./allocation";

export type OrderRule = "out" | "smooth";
export type StageKey = "retailer" | "distributor" | "manufacturer";

export interface StageParams {
  /** Replenishment lead time into this stage, weeks (manufacturer: production time). */
  leadTime: number;
  rule: OrderRule;
  /** Starting on-hand stock, in weeks of average demand through the node. */
  startCover: number;
  /** Holding cost per unit per week. */
  holding: number;
  /** Backlog cost per unit per week owed downstream (customers for retailers). */
  backlog: number;
}

export interface BullwhipConfig {
  retailer: StageParams;
  distributor: StageParams;
  manufacturer: StageParams;
  /** Shipping cost per unit on each distributor -> retailer lane [d][r]. */
  laneCost: number[][];
  /** Retailer -> assigned distributor under fixed (legacy) routing. */
  assign: number[];
  /** Moving-average window for naive forecasting, weeks. */
  window: number;
  /** Safety factor z in the order-up-to level. */
  safetyZ: number;
  /** Fraction of the gap ordered each week under the smoothed rule. */
  smoothing: number;
  infoSharing: boolean;
}

export interface RunMode {
  forecast: "naive" | "ml";
  routing: "fixed" | "optimised";
}

export interface BullwhipInput {
  /** Customer demand per retailer [r][t] over the simulated weeks. */
  demand: number[][];
  /** Demand in the weeks before the horizon [r][k] (warms up the moving averages). */
  preDemand: number[][];
  /** ML forecast of demand[r][t] made at the end of week t-1 [r][t]; length horizon + 1. */
  mlForecast: number[][];
  /** Out-of-sample forecast error sd per retailer. */
  mlSigma: number[];
  config: BullwhipConfig;
  mode: RunMode;
  /** Weeks excluded from the metrics while the system settles. */
  warmup: number;
}

export interface StageMetrics {
  orders: number[];
  /** Variance of this stage's orders / variance of total customer demand. */
  bullwhip: number;
  fillRate: number;
  avgBacklog: number;
  avgInventory: number;
  holdingCost: number;
  backlogCost: number;
  shippingCost: number;
  totalCost: number;
}

export interface BullwhipResult {
  weeks: number;
  warmup: number;
  customerDemand: number[];
  stages: Record<StageKey, StageMetrics>;
  /** Orders per node: retailers then distributors then manufacturer production. */
  nodeOrders: { id: string; orders: number[]; bullwhip: number }[];
  /** Units shipped over the measured weeks on each distributor -> retailer lane [d][r]. */
  laneVolume: number[][];
  /** Units shipped manufacturer -> distributor [d]. */
  mfgVolume: number[];
  /** Inventory (on hand - backlog) per stage over time. */
  netInventory: Record<StageKey, number[]>;
  totalCost: number;
}

interface Queue {
  qty: number;
  from: number;
}

const variance = (xs: number[]): number => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1);
};

function movingStats(series: number[], k: number): { mean: number; sd: number } {
  const w = series.slice(-k);
  const m = w.reduce((a, b) => a + b, 0) / w.length;
  const v = w.length > 1 ? w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1) : 0;
  return { mean: m, sd: Math.sqrt(v) };
}

/** Each retailer's cheapest distributor lane (ties keep the legacy assignment). */
export function cheapestAssignment(laneCost: number[][], legacy: number[]): number[] {
  return legacy.map((cur, r) => {
    let best = cur;
    for (let d = 0; d < laneCost.length; d++) if (laneCost[d][r] < laneCost[best][r] - 1e-12) best = d;
    return best;
  });
}

function orderQty(rule: OrderRule, smoothing: number, target: number, position: number, forecast: number): number {
  const gap = target - position;
  if (rule === "out") return Math.max(0, gap);
  // Proportional (smoothed) order-up-to: replace expected demand, close a fraction of the rest.
  return Math.max(0, forecast + smoothing * (gap - forecast));
}

export function simulateBullwhip(inp: BullwhipInput): BullwhipResult {
  const { config: cfg, mode } = inp;
  const R = inp.demand.length;
  const D = cfg.laneCost.length;
  const T = inp.demand[0].length;
  const z = cfg.safetyZ;
  const Lr = Math.max(1, Math.round(cfg.retailer.leadTime));
  const Ld = Math.max(1, Math.round(cfg.distributor.leadTime));
  const Lm = Math.max(1, Math.round(cfg.manufacturer.leadTime));
  // Planning assignment: fixed routing keeps the legacy assignment; AI routing redesigns the
  // network so each retailer is planned on its cheapest-to-serve distributor.
  const plan = mode.routing === "optimised" ? cheapestAssignment(cfg.laneCost, cfg.assign) : cfg.assign;
  const assigned = (d: number): number[] => plan.map((a, r) => (a === d ? r : -1)).filter((r) => r >= 0);
  const mean0 = inp.preDemand.map((p) => p.reduce((a, b) => a + b, 0) / p.length);
  const distMean0 = Array.from({ length: D }, (_, d) => assigned(d).reduce((a, r) => a + mean0[r], 0));
  const totalMean0 = mean0.reduce((a, b) => a + b, 0);
  const useMl = mode.forecast === "ml";
  const share = useMl && cfg.infoSharing;

  // State, initialised at steady state: stock = startCover weeks, pipelines full of average flow.
  const rOn = mean0.map((m) => m * cfg.retailer.startCover);
  const rBack = new Array(R).fill(0);
  const rIn: number[][] = mean0.map((m) => Array.from({ length: T + Lr + 2 }, (_, k) => (k < Lr ? m : 0)));
  const dOn = distMean0.map((m) => m * cfg.distributor.startCover);
  const dIn: number[][] = distMean0.map((m) => Array.from({ length: T + Ld + 2 }, (_, k) => (k < Ld ? m : 0)));
  let mOn = totalMean0 * cfg.manufacturer.startCover;
  const mWip: number[] = Array.from({ length: T + Lm + 2 }, (_, k) => (k < Lm ? totalMean0 : 0));
  const owedToR: Queue[][] = Array.from({ length: R }, () => []); // retailer orders not yet shipped
  const owedToD: Queue[][] = Array.from({ length: D }, () => []); // distributor orders not yet shipped
  const rOnOrder = mean0.map((m) => m * Lr);
  const dOnOrder = distMean0.map((m) => m * Ld);

  const rSeen: number[][] = inp.preDemand.map((p) => p.slice());
  const dSeen: number[][] = distMean0.map((m) => new Array(cfg.window).fill(m));
  const mSeen: number[] = new Array(cfg.window).fill(totalMean0);

  const rOrders: number[][] = Array.from({ length: R }, () => []);
  const dOrders: number[][] = Array.from({ length: D }, () => []);
  const mOrders: number[] = [];
  const custTotal: number[] = [];
  const laneVolume = Array.from({ length: D }, () => new Array(R).fill(0));
  const mfgVolume = new Array(D).fill(0);
  const net = { retailer: [] as number[], distributor: [] as number[], manufacturer: [] as number[] };
  const acc = {
    retailer: { demand: 0, filled: 0, backlog: 0, inv: 0, hold: 0, back: 0, ship: 0 },
    distributor: { demand: 0, filled: 0, backlog: 0, inv: 0, hold: 0, back: 0, ship: 0 },
    manufacturer: { demand: 0, filled: 0, backlog: 0, inv: 0, hold: 0, back: 0, ship: 0 },
  };
  const owedSum = (q: Queue[]): number => q.reduce((a, x) => a + x.qty, 0);

  /** Ship `amount` against a FIFO queue; returns units shipped and how many were same-week. */
  const drain = (q: Queue[], amount: number, week: number): { shipped: number; sameWeek: number } => {
    let left = amount;
    let sameWeek = 0;
    while (left > 1e-9 && q.length) {
      const take = Math.min(left, q[0].qty);
      if (q[0].from === week) sameWeek += take;
      q[0].qty -= take;
      left -= take;
      if (q[0].qty <= 1e-9) q.shift();
    }
    return { shipped: amount - left, sameWeek };
  };

  for (let t = 0; t < T; t++) {
    const measured = t >= inp.warmup;
    // 1. Arrivals.
    for (let r = 0; r < R; r++) {
      rOn[r] += rIn[r][t];
      rOnOrder[r] -= rIn[r][t];
    }
    for (let d = 0; d < D; d++) {
      dOn[d] += dIn[d][t];
      dOnOrder[d] -= dIn[d][t];
    }
    mOn += mWip[t];

    // 2. Retailers serve customers (backlog first, then this week's demand).
    let cust = 0;
    for (let r = 0; r < R; r++) {
      const dem = inp.demand[r][t];
      cust += dem;
      const fromBacklog = Math.min(rOn[r], rBack[r]);
      rOn[r] -= fromBacklog;
      rBack[r] -= fromBacklog;
      const now = Math.min(rOn[r], dem);
      rOn[r] -= now;
      rBack[r] += dem - now;
      if (measured) {
        acc.retailer.demand += dem;
        acc.retailer.filled += now;
      }
      rSeen[r].push(dem);
    }
    custTotal.push(cust);

    // 3. Retailer forecasts and orders.
    const rForecast: number[] = new Array(R);
    const rSigma: number[] = new Array(R);
    for (let r = 0; r < R; r++) {
      if (useMl) {
        rForecast[r] = inp.mlForecast[r][t + 1];
        rSigma[r] = inp.mlSigma[r];
      } else {
        const s = movingStats(rSeen[r], cfg.window);
        rForecast[r] = s.mean;
        rSigma[r] = s.sd;
      }
      const target = rForecast[r] * (Lr + 1) + z * rSigma[r] * Math.sqrt(Lr + 1);
      const position = rOn[r] - rBack[r] + rOnOrder[r] + owedSum(owedToR[r]);
      const q = orderQty(cfg.retailer.rule, cfg.smoothing, target, position, rForecast[r]);
      rOrders[r].push(q);
      if (q > 0) owedToR[r].push({ qty: q, from: t });
    }

    // 4. Distributors ship to retailers.
    const shipped = Array.from({ length: D }, () => new Array(R).fill(0));
    const distIncoming = new Array(D).fill(0);
    for (let r = 0; r < R; r++) distIncoming[plan[r]] += rOrders[r][t];
    if (mode.routing === "fixed") {
      for (let d = 0; d < D; d++) {
        // First come first served across this distributor's retailers.
        const mine = assigned(d);
        const entries = mine.flatMap((r) => owedToR[r].map((q) => ({ r, q })));
        entries.sort((a, b) => a.q.from - b.q.from || a.r - b.r);
        for (const { r, q } of entries) {
          const take = Math.min(dOn[d], q.qty);
          if (take <= 0) break;
          shipped[d][r] += take;
          dOn[d] -= take;
        }
      }
    } else {
      // AI routing: min-cost allocation, prioritising retailers forecast to run short.
      const need = owedToR.map(owedSum);
      const urgency = rForecast.map((f, r) => {
        const cover = rOn[r] - rBack[r] + rOnOrder[r];
        const gap = Math.max(0, f * (Lr + 1) - cover);
        return 1 + Math.min(3, gap / Math.max(f, 1));
      });
      const res = allocate({
        stock: dOn.slice(),
        need,
        laneCost: cfg.laneCost,
        backlogCost: urgency.map((u) => cfg.distributor.backlog * u),
        holdingCost: new Array(D).fill(cfg.distributor.holding),
      });
      for (let d = 0; d < D; d++)
        for (let r = 0; r < R; r++) {
          shipped[d][r] = res.ship[d][r];
          dOn[d] -= res.ship[d][r];
        }
    }
    for (let r = 0; r < R; r++) {
      let total = 0;
      for (let d = 0; d < D; d++) {
        total += shipped[d][r];
        if (shipped[d][r] > 0) rIn[r][t + Lr] += shipped[d][r];
        if (measured) {
          laneVolume[d][r] += shipped[d][r];
          acc.distributor.ship += shipped[d][r] * cfg.laneCost[d][r];
        }
      }
      const { sameWeek } = drain(owedToR[r], total, t);
      rOnOrder[r] += total;
      if (measured) {
        acc.distributor.demand += rOrders[r][t];
        acc.distributor.filled += sameWeek;
      }
    }

    // 5. Distributor forecasts and orders.
    for (let d = 0; d < D; d++) {
      dSeen[d].push(distIncoming[d]);
      let f: number;
      let sig: number;
      if (share) {
        f = assigned(d).reduce((a, r) => a + rForecast[r], 0);
        sig = Math.sqrt(assigned(d).reduce((a, r) => a + rSigma[r] ** 2, 0));
      } else {
        const s = movingStats(dSeen[d], cfg.window);
        f = s.mean;
        sig = s.sd;
      }
      const owedDown = assigned(d).reduce((a, r) => a + owedSum(owedToR[r]), 0);
      const target = f * (Ld + 1) + z * sig * Math.sqrt(Ld + 1);
      const position = dOn[d] - owedDown + dOnOrder[d] + owedSum(owedToD[d]);
      const q = orderQty(cfg.distributor.rule, cfg.smoothing, target, position, f);
      dOrders[d].push(q);
      if (q > 0) owedToD[d].push({ qty: q, from: t });
    }

    // 6. Manufacturer ships to distributors (first come first served) and releases production.
    const mEntries = owedToD.flatMap((q, d) => q.map((e) => ({ d, e })));
    mEntries.sort((a, b) => a.e.from - b.e.from || a.d - b.d);
    const mShip = new Array(D).fill(0);
    for (const { d, e } of mEntries) {
      const take = Math.min(mOn, e.qty);
      if (take <= 0) break;
      mShip[d] += take;
      mOn -= take;
    }
    let mIncoming = 0;
    for (let d = 0; d < D; d++) {
      mIncoming += dOrders[d][t];
      const { sameWeek } = drain(owedToD[d], mShip[d], t);
      if (mShip[d] > 0) dIn[d][t + Ld] += mShip[d];
      dOnOrder[d] += mShip[d];
      if (measured) {
        mfgVolume[d] += mShip[d];
        acc.manufacturer.demand += dOrders[d][t];
        acc.manufacturer.filled += sameWeek;
      }
    }
    mSeen.push(mIncoming);
    let mf: number;
    let ms: number;
    if (share) {
      mf = rForecast.reduce((a, b) => a + b, 0);
      ms = Math.sqrt(rSigma.reduce((a, b) => a + b * b, 0));
    } else {
      const s = movingStats(mSeen, cfg.window);
      mf = s.mean;
      ms = s.sd;
    }
    const mOwed = owedToD.reduce((a, q) => a + owedSum(q), 0);
    let wip = 0;
    for (let k = t + 1; k < mWip.length; k++) wip += mWip[k];
    const mTarget = mf * (Lm + 1) + z * ms * Math.sqrt(Lm + 1);
    const mQ = orderQty(cfg.manufacturer.rule, cfg.smoothing, mTarget, mOn - mOwed + wip, mf);
    mOrders.push(mQ);
    mWip[t + Lm] += mQ;

    // Costs and inventory (end of week).
    const rOnSum = rOn.reduce((a, b) => a + b, 0);
    const rBackSum = rBack.reduce((a, b) => a + b, 0);
    const dOnSum = dOn.reduce((a, b) => a + b, 0);
    const dBackSum = owedToR.reduce((a, q) => a + owedSum(q), 0);
    net.retailer.push(rOnSum - rBackSum);
    net.distributor.push(dOnSum - dBackSum);
    net.manufacturer.push(mOn - mOwed);
    if (measured) {
      acc.retailer.inv += rOnSum;
      acc.retailer.backlog += rBackSum;
      acc.retailer.hold += cfg.retailer.holding * rOnSum;
      acc.retailer.back += cfg.retailer.backlog * rBackSum;
      acc.distributor.inv += dOnSum;
      acc.distributor.backlog += dBackSum;
      acc.distributor.hold += cfg.distributor.holding * dOnSum;
      acc.distributor.back += cfg.distributor.backlog * dBackSum;
      acc.manufacturer.inv += mOn;
      acc.manufacturer.backlog += mOwed;
      acc.manufacturer.hold += cfg.manufacturer.holding * mOn;
      acc.manufacturer.back += cfg.manufacturer.backlog * mOwed;
    }
  }

  const W = inp.warmup;
  const cust = custTotal.slice(W);
  const vc = variance(cust);
  const sumAcross = (rows: number[][]): number[] => rows[0].map((_, t) => rows.reduce((a, row) => a + row[t], 0));
  const stageOrders: Record<StageKey, number[]> = {
    retailer: sumAcross(rOrders),
    distributor: sumAcross(dOrders),
    manufacturer: mOrders,
  };
  const n = T - W;
  const stages = {} as Record<StageKey, StageMetrics>;
  for (const k of ["retailer", "distributor", "manufacturer"] as StageKey[]) {
    const a = acc[k];
    const orders = stageOrders[k];
    stages[k] = {
      orders,
      bullwhip: variance(orders.slice(W)) / vc,
      fillRate: a.demand > 0 ? a.filled / a.demand : 1,
      avgBacklog: a.backlog / n,
      avgInventory: a.inv / n,
      holdingCost: a.hold,
      backlogCost: a.back,
      shippingCost: a.ship,
      totalCost: a.hold + a.back + a.ship,
    };
  }
  const nodeOrders = [
    ...rOrders.map((o, r) => ({ id: `R${r + 1}`, orders: o, bullwhip: variance(o.slice(W)) / variance(inp.demand[r].slice(W)) })),
    ...dOrders.map((o, d) => ({ id: `D${d + 1}`, orders: o, bullwhip: variance(o.slice(W)) / variance(sumAcross(assigned(d).map((r) => inp.demand[r])).slice(W)) })),
    { id: "M", orders: mOrders, bullwhip: variance(mOrders.slice(W)) / vc },
  ];
  return {
    weeks: T,
    warmup: W,
    customerDemand: custTotal,
    stages,
    nodeOrders,
    laneVolume,
    mfgVolume,
    netInventory: net,
    totalCost: stages.retailer.totalCost + stages.distributor.totalCost + stages.manufacturer.totalCost,
  };
}
