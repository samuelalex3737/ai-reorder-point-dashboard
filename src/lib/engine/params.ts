/** Dashboard controls and scenario presets. Time unit: weeks. */
import type { SkuPolicyDefaults } from "../types";

export interface Controls {
  /** Target cycle service level used for Z and the Monte Carlo quantile (0.80-0.995). */
  serviceLevel: number;
  leadTime: number;
  leadTimeSd: number;
  holdingCost: number;
  stockoutCost: number;
  orderCost: number;
  /** Optimisation constraint: minimum fill rate. */
  targetFillRate: number;
  /** Optimisation constraint: s + Q must fit in storage. */
  capacity: number;
  budgetEnabled: boolean;
  /** Optional constraint: average inventory value (units x unit price) must not exceed this. */
  budget: number;
}

export type ScenarioKey = "normal" | "surge" | "disruption" | "promotion" | "crisis";

export interface Scenario {
  key: ScenarioKey;
  name: string;
  description: string;
  demandMult: number;
  sigmaDMult: number;
  leadTimeMult: number;
  leadTimeSdMult: number;
  /** Planned promotions: number of upcoming weeks and promotion days in each. */
  promoWeeks: number;
  promoDaysPerWeek: number;
}

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  normal: {
    key: "normal",
    name: "Normal",
    description: "Forecast as estimated, lead times as contracted.",
    demandMult: 1,
    sigmaDMult: 1,
    leadTimeMult: 1,
    leadTimeSdMult: 1,
    promoWeeks: 0,
    promoDaysPerWeek: 0,
  },
  surge: {
    key: "surge",
    name: "Demand surge",
    description: "Demand runs 30% above forecast and forecast error grows by 50%.",
    demandMult: 1.3,
    sigmaDMult: 1.5,
    leadTimeMult: 1,
    leadTimeSdMult: 1,
    promoWeeks: 0,
    promoDaysPerWeek: 0,
  },
  disruption: {
    key: "disruption",
    name: "Supplier disruption",
    description: "Lead time 50% longer and twice as variable.",
    demandMult: 1,
    sigmaDMult: 1,
    leadTimeMult: 1.5,
    leadTimeSdMult: 2,
    promoWeeks: 0,
    promoDaysPerWeek: 0,
  },
  promotion: {
    key: "promotion",
    name: "Promotion period",
    description: "Three promotion days a week for the next 8 weeks; forecast error up 20%.",
    demandMult: 1,
    sigmaDMult: 1.2,
    leadTimeMult: 1,
    leadTimeSdMult: 1,
    promoWeeks: 8,
    promoDaysPerWeek: 3,
  },
  crisis: {
    key: "crisis",
    name: "Combined crisis",
    description: "Demand surge and supplier disruption at the same time.",
    demandMult: 1.3,
    sigmaDMult: 1.5,
    leadTimeMult: 1.5,
    leadTimeSdMult: 2,
    promoWeeks: 0,
    promoDaysPerWeek: 0,
  },
};

export const SCENARIO_KEYS = Object.keys(SCENARIOS) as ScenarioKey[];

export function defaultControls(d: SkuPolicyDefaults): Controls {
  return {
    serviceLevel: 0.95,
    leadTime: d.leadTime,
    leadTimeSd: d.leadTimeSd,
    holdingCost: d.holdingCost,
    stockoutCost: d.stockoutCost,
    orderCost: d.orderCost,
    targetFillRate: 0.98,
    capacity: d.capacity,
    budgetEnabled: false,
    budget: 25_000,
  };
}

/** Forecast horizon in weeks: 8 warm-up + 52 simulated weeks + lead-time look-ahead. */
export const FORECAST_HORIZON = 76;
export const SIM_WEEKS = 60;

/** Planned promotion days for each future week under a scenario. */
export function futurePromoPlan(scenario: Scenario, expectedPromoDays: number, horizon = FORECAST_HORIZON): number[] {
  return Array.from({ length: horizon }, (_, h) => (h < scenario.promoWeeks ? scenario.promoDaysPerWeek : expectedPromoDays));
}
