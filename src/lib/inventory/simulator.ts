/**
 * Stochastic inventory simulator for a weekly-review (s, Q) policy with backorders and
 * random lead times. Every policy is evaluated on the same pre-generated demand and
 * lead-time draws (common random numbers, Glasserman and Yao, 1992), so differences in
 * cost come from the policy, not from luck.
 *
 * Week t sequence: receive orders due in week t; meet demand (unmet demand is backordered);
 * review the inventory position and, if it is at or below s_t, order the smallest multiple
 * of Q that lifts it above s_t. An order placed in week t arrives at the start of week t + lt.
 */
import { drawLeadTime, Rng } from "../rng";

export interface SimScenario {
  /** Mean weekly demand for each simulated week (warm-up weeks first). */
  demandMean: number[];
  sigmaD: number;
  L: number;
  sigmaL: number;
  holdingCost: number;
  stockoutCost: number;
  orderCost: number;
  reps?: number;
  warmup?: number;
  seed?: number;
}

/** Pre-generated random draws shared by every policy evaluated on a scenario. */
export interface SimDraws {
  reps: number;
  weeks: number;
  warmup: number;
  demand: Float64Array; // reps x weeks
  leadTime: Int32Array; // reps x weeks, lead time of an order placed that week (>= 1)
  maxLead: number;
  scenario: SimScenario;
}

export interface Policy {
  /** Reorder point: a constant, or one value per simulated week (dynamic). */
  s: number | number[];
  Q: number;
}

export interface SimResult {
  annualCost: number;
  holding: number;
  shortage: number;
  ordering: number;
  /** Share of demand met from stock. */
  fillRate: number;
  /** Share of replenishment cycles with no stockout (achieved cycle service level). */
  cycleServiceLevel: number;
  /** Share of weeks with a stockout. */
  weeklyStockoutProb: number;
  avgOnHand: number;
  ordersPerYear: number;
  maxS: number;
}

export const SIM_REPS = 200;
export const SIM_WARMUP = 8;
export const SIM_SEED = 7;

export function generateDraws(sc: SimScenario): SimDraws {
  const reps = sc.reps ?? SIM_REPS;
  const weeks = sc.demandMean.length;
  const warmup = sc.warmup ?? SIM_WARMUP;
  const rng = new Rng(sc.seed ?? SIM_SEED);
  const demand = new Float64Array(reps * weeks);
  const leadTime = new Int32Array(reps * weeks);
  const maxLead = Math.max(1, Math.ceil(sc.L + 6 * sc.sigmaL) + 1);
  for (let r = 0; r < reps; r++) {
    for (let t = 0; t < weeks; t++) {
      demand[r * weeks + t] = Math.max(0, sc.demandMean[t] + sc.sigmaD * rng.normal());
      leadTime[r * weeks + t] = Math.min(maxLead, Math.max(1, Math.round(drawLeadTime(rng, sc.L, sc.sigmaL))));
    }
  }
  return { reps, weeks, warmup, demand, leadTime, maxLead, scenario: sc };
}

export interface TraceWeek {
  week: number;
  onHand: number;
  inventoryPosition: number;
  reorderPoint: number;
  demand: number;
  ordered: number;
  arrived: number;
  shortage: number;
}

function sAt(policy: Policy, t: number): number {
  return typeof policy.s === "number" ? policy.s : policy.s[Math.min(t, policy.s.length - 1)];
}

/** Simulate one policy on shared draws. Pass `trace` to record replication 0 week by week. */
export function simulate(draws: SimDraws, policy: Policy, trace?: TraceWeek[]): SimResult {
  const { reps, weeks, warmup, demand, leadTime, maxLead, scenario: sc } = draws;
  const Q = Math.max(1, policy.Q);
  const measured = weeks - warmup;
  const arrivals = new Float64Array(weeks + maxLead + 1);
  let holdUnits = 0;
  let shortUnits = 0;
  let demandUnits = 0;
  let orders = 0;
  let stockoutWeeks = 0;
  let cycles = 0;
  let badCycles = 0;
  let maxS = 0;
  for (let t = 0; t < weeks; t++) maxS = Math.max(maxS, sAt(policy, t));

  for (let r = 0; r < reps; r++) {
    arrivals.fill(0);
    let net = sAt(policy, 0) + Q / 2; // net inventory (negative = backorders)
    let pipeline = 0;
    let cycleOpen = false;
    let cycleHadShortage = false;
    for (let t = 0; t < weeks; t++) {
      const arrived = arrivals[t];
      net += arrived;
      pipeline -= arrived;
      const d = demand[r * weeks + t];
      const available = Math.max(net, 0);
      const short = Math.max(0, d - available);
      net -= d;
      const s = sAt(policy, t);
      const ip = net + pipeline;
      let ordered = 0;
      if (ip <= s) {
        ordered = Math.ceil((s - ip + 1e-9) / Q) * Q;
        arrivals[t + leadTime[r * weeks + t]] += ordered;
        pipeline += ordered;
      }
      if (t >= warmup) {
        holdUnits += Math.max(net, 0);
        shortUnits += short;
        demandUnits += d;
        if (short > 0) stockoutWeeks++;
        if (ordered > 0) orders++;
        if (short > 0) cycleHadShortage = true;
        if (ordered > 0) {
          if (cycleOpen) {
            cycles++;
            if (cycleHadShortage) badCycles++;
          }
          cycleOpen = true;
          cycleHadShortage = false;
        }
      }
      if (trace && r === 0) {
        trace.push({ week: t - warmup + 1, onHand: net, inventoryPosition: net + pipeline, reorderPoint: s, demand: d, ordered, arrived, shortage: short });
      }
    }
  }

  const unitWeeks = measured * reps;
  const perYear = 52 / unitWeeks;
  const holding = sc.holdingCost * holdUnits * perYear;
  const shortage = sc.stockoutCost * shortUnits * perYear;
  const ordering = sc.orderCost * orders * perYear;
  return {
    annualCost: holding + shortage + ordering,
    holding,
    shortage,
    ordering,
    fillRate: demandUnits > 0 ? 1 - shortUnits / demandUnits : 1,
    cycleServiceLevel: cycles > 0 ? 1 - badCycles / cycles : 1,
    weeklyStockoutProb: stockoutWeeks / unitWeeks,
    avgOnHand: holdUnits / unitWeeks,
    ordersPerYear: orders * perYear,
    maxS,
  };
}
