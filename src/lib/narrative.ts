/**
 * Plain-language explanations for an operations manager, generated from live numbers.
 * Every sentence is built from the current results; nothing here is fixed commentary.
 */
import type { EngineResult, PolicyResult } from "./engine/inventoryEngine";
import type { Scenario } from "./engine/params";
import type { PipelineResult } from "./forecast/pipeline";
import { MODEL_INFO } from "./forecast/pipeline";
import type { Decision } from "./inventory/decision";
import type { VersionEntry } from "./data/persistence";
import { fmt, money, pct, signed } from "./format";
import type { LabResult } from "./bullwhip/lab";

const plural = (n: number, w: string): string => `${fmt(n)} ${w}${Math.round(n) === 1 ? "" : "s"}`;

export function forecastStory(r: PipelineResult, skuLabel: string): string {
  const sorted = [...r.models].sort((a, b) => a.metrics.wape - b.metrics.wape);
  const best = sorted[0];
  const naive = r.models.find((m) => m.key === "naive")!;
  const gain = (1 - best.metrics.wape / naive.metrics.wape) * 100;
  const next4 = r.forecast.slice(0, 4).reduce((a, f) => a + f.mean, 0);
  const lastYear = r.testActual.slice(-4).reduce((a, b) => a + b, 0);
  const bias = best.metrics.bias;
  return (
    `${MODEL_INFO[best.key].name} is the most accurate model for ${skuLabel}: over the last ${r.testActual.length} weeks, predicted one week ahead without seeing the answer, it was off by ${fmt(best.metrics.wape, 1)}% of demand (WAPE), ` +
    `${fmt(gain, 0)}% better than simply repeating last week. Its typical weekly miss is ${fmt(r.sigmaD, 1)} units, and that error, not raw demand swings, is what the safety stock now has to cover. ` +
    `It ${Math.abs(bias) < 1 ? "shows no meaningful bias" : bias > 0 ? `over-forecasts slightly (${fmt(bias, 1)}%)` : `under-forecasts slightly (${fmt(Math.abs(bias), 1)}%)`}. ` +
    `Expect about ${fmt(next4)} units over the next 4 weeks, against ${fmt(lastYear)} in the last 4 weeks of history; the shaded band shows where actual demand should land 80% and 95% of the time.`
  );
}

export function leaderboardStory(r: PipelineResult): string {
  const sorted = [...r.models].sort((a, b) => a.metrics.wape - b.metrics.wape);
  const worst = sorted[sorted.length - 1];
  const rf = r.models.find((m) => m.key === "randomForest");
  const lstm = r.models.find((m) => m.key === "lstm");
  const parts = [
    `Ranked by WAPE on ${r.testActual.length} unseen weeks (training used ${r.trainRows} earlier weeks). ${MODEL_INFO[sorted[0].key].name} leads at ${fmt(sorted[0].metrics.wape, 2)}%; ${MODEL_INFO[worst.key].name} trails at ${fmt(worst.metrics.wape, 2)}%.`,
  ];
  if (rf) parts.push(`The professor's Random Forest scores ${fmt(rf.metrics.wape, 2)}% here; scored on its own training rows (as in the starter notebook) it would look far better than it really is.`);
  if (lstm) parts.push(`The LSTM scores ${fmt(lstm.metrics.wape, 2)}%, rank ${sorted.findIndex((m) => m.key === "lstm") + 1} of ${sorted.length}.`);
  return parts.join(" ");
}

export function versionStory(v: VersionEntry[]): string {
  if (v.length === 0) return "The log starts when the first forecast finishes.";
  const first = v[0];
  const last = v[v.length - 1];
  if (v.length === 1) return `Version 1 trained on ${plural(first.rows, "week")}. Add, upload or stream a week and every model is retrained; each change is logged here so you can see whether accuracy and buffers improve.`;
  const dW = last.wape - first.wape;
  const dS = last.sigmaD - first.sigmaD;
  const ropTxt = last.rop !== null && first.rop !== null ? ` and the reorder point moved ${signed(last.rop - first.rop)} units` : "";
  return `${plural(v.length, "version")} so far, from ${plural(first.rows, "week")} to ${plural(last.rows, "week")} of history. Since version 1, the best model's WAPE changed by ${signed(dW, 2)} points and sigma_D by ${signed(dS, 1)} units${ropTxt}. The latest best model is ${last.bestModel} (LSTM: ${last.lstm}).`;
}

export function mcStory(e: EngineResult, serviceLevel: number): string {
  const m = e.mc;
  return (
    `In ${fmt(m.draws)} simulated replenishment cycles, demand while waiting for a delivery averaged ${fmt(m.ltdMean)} units, but lead times ran up to ${fmt(m.leadTimeP95, 1)} weeks in the worst 5% of cycles. ` +
    `To be safe in ${pct(serviceLevel, 1)} of cycles you should reorder at ${fmt(m.ropMC)} units (Monte Carlo) against ${fmt(m.ropFormula)} from the slide formula. ` +
    `The gap of ${signed(m.ropMC - m.ropFormula)} units comes from late deliveries being more likely than early ones (a right-skewed lead time), which the formula's normal approximation misses: at the formula ROP the simulated stockout risk is ${pct(m.stockoutProbAtFormula, 1)} instead of ${pct(1 - serviceLevel, 1)}. The shaded tail is the stockout risk.`
  );
}

export function ssStory(e: EngineResult, serviceLevel: number): string {
  const p = e.curve.find((c) => Math.abs(c.serviceLevel - Math.min(0.99, Math.round(serviceLevel * 100) / 100)) < 1e-9) ?? e.curve[e.curve.length - 1];
  const share = e.ss.shares.leadTime;
  return (
    `At ${pct(p.serviceLevel, 0)} service the professor's formula holds ${fmt(p.ssBaseline)} units of safety stock, the slide formula ${fmt(p.ssFormula)} and Monte Carlo ${fmt(p.ssMonteCarlo)}. ` +
    `The baseline uses raw demand swings (sd ${fmt(e.effective.sigmaRaw)} units/week), which includes predictable seasonality and promotions, yet it ignores late deliveries. ` +
    `Lead-time uncertainty accounts for ${pct(share, 0)} of the risk here, so the baseline under-protects. Each extra service point costs more than the last: going from 95% to 99% raises the slide-formula buffer by ${fmt(e.curve[19].ssFormula - e.curve[15].ssFormula)} units (${money(e.curve[19].holdFormula - e.curve[15].holdFormula)} a week more to hold).`
  );
}

export function cslStory(e: EngineResult, serviceLevel: number, targetFill: number): string {
  const d = e.policies.find((p) => p.key === "dynamic")!;
  return (
    `Two different promises: the cycle service level (CSL) is the chance of getting through a replenishment cycle with no stockout at all, while the fill rate is the share of units served from the shelf. ` +
    `The forecast-driven policy targets a ${pct(serviceLevel, 1)} CSL through Z = ${fmt(e.effective.z, 4)} and achieves ${pct(d.sim.cycleServiceLevel, 1)} in simulation, but its fill rate is ${pct(d.sim.fillRate, 1)}, because even a cycle with a stockout usually misses only a few units out of an order of ${fmt(d.Q)}. ` +
    `The Monte Carlo ROP implies a ${pct(e.mc.impliedFillRate, 2)} fill rate. That is why the optimiser can meet a ${pct(targetFill, 0)} fill-rate target with a lower reorder point than the CSL formula suggests.`
  );
}

export function traceStory(p: PolicyResult, weeks: number): string {
  const orders = p.trace.filter((w) => w.ordered > 0).length;
  const stockWeeks = p.trace.filter((w) => w.shortage > 0).length;
  const minOn = Math.min(...p.trace.map((w) => w.onHand));
  return (
    `One simulated year (${weeks} weeks) under "${p.name}". The inventory position (on hand plus on order) triggers ${plural(orders, "order")} whenever it drops to the reorder line; each delivery lifts on-hand stock by ${fmt(p.Q)} units. ` +
    (stockWeeks > 0
      ? `In this run stock ran out in ${plural(stockWeeks, "week")} (lowest point ${fmt(minOn)} units, negative means backorders).`
      : `Stock never ran out in this run; the lowest on-hand level was ${fmt(minOn)} units.`) +
    ` Across all 200 simulated years the fill rate is ${pct(p.sim.fillRate, 1)}.`
  );
}

export function comparisonStory(e: EngineResult, targetFill: number): string {
  const ps = e.policies;
  const base = ps.find((p) => p.key === "static")!;
  const feasible = ps.filter((p) => p.targetMet && p.capacityOk);
  const cheapest = (feasible.length ? feasible : ps).reduce((a, b) => (b.sim.annualCost < a.sim.annualCost ? b : a));
  const baseMiss = ps.filter((p) => p.kind === "baseline" && !p.targetMet).length;
  const saving = base.sim.annualCost - cheapest.sim.annualCost;
  return (
    `All five policies were run on the same 200 simulated years of demand and lead times. ` +
    `${baseMiss === 2 ? "Both baseline policies miss" : baseMiss === 1 ? "One baseline policy misses" : "Both baseline policies meet"} the ${pct(targetFill, 0)} fill-rate target (static baseline: ${pct(base.sim.fillRate, 1)}, ${pct(base.sim.weeklyStockoutProb, 1)} of weeks with a stockout). ` +
    `The best policy that meets every constraint is "${cheapest.name}" at ${money(cheapest.sim.annualCost)} a year, ` +
    (saving >= 0 ? `${money(saving)} cheaper than the static baseline` : `${money(-saving)} more than the static baseline, the price of actually meeting the service target`) +
    `, with a ${pct(cheapest.sim.fillRate, 1)} fill rate.`
  );
}

export function dynamicRopStory(e: EngineResult, weeks: number): string {
  const d = e.dynamicRop.slice(0, weeks);
  const hi = d.reduce((a, b) => (b.rop > a.rop ? b : a));
  const lo = d.reduce((a, b) => (b.rop < a.rop ? b : a));
  const flat = e.ss.ropStatic;
  const under = d.filter((p) => p.rop > flat).length;
  return (
    `The adaptive reorder point is recalculated every week from the forecast for that week's lead-time window. Over the next ${weeks} weeks it ranges from ${fmt(lo.rop)} (week ${lo.week}) to ${fmt(hi.rop)} (week ${hi.week}). ` +
    `The baseline keeps one flat line at ${fmt(flat)}, which is too low in ${plural(under, "week")} (stockout exposure) and too high in the other ${plural(weeks - under, "week")} (excess stock). Following the forecast removes both errors.`
  );
}

export function convergenceStory(e: EngineResult): string {
  const o = e.optimisation;
  const bo = o.bo.best.objective;
  const rs = o.random[o.random.length - 1].bestSoFar;
  const mg = o.manual[o.manual.length - 1].bestSoFar;
  const firstWithin = o.bo.evaluations.findIndex((ev) => ev.bestSoFar <= bo * 1.01) + 1;
  const vsRandom = rs > bo ? `${money(rs - bo)} better than random search` : rs < bo ? `${money(bo - rs)} behind random search on this run` : "level with random search";
  const vsGrid = mg > bo ? `${money(mg - bo)} better than the 42-point manual grid` : `${money(bo - mg)} behind the 42-point manual grid on this run`;
  return (
    `With the same 40-simulation budget and seed, Bayesian optimisation reached ${money(bo)} (cost plus any constraint penalty), ${vsRandom} and ${vsGrid}. ` +
    `It was within 1% of its final answer after ${plural(firstWithin, "evaluation")}. The exhaustive 400-point grid, ten times the budget, finds ${money(o.fullGridBest.objective)}; BO is ${o.gapPct <= 0 ? `${fmt(-o.gapPct, 2)}% better than that` : `${fmt(o.gapPct, 2)}% above it`}.`
  );
}

export function heatmapStory(e: EngineResult, capacity: number): string {
  const o = e.optimisation;
  const cells = o.heat.flat();
  const infeasible = cells.filter((c) => !c.feasible).length;
  return (
    `Each cell is the simulated annual cost of one (reorder point, order quantity) pair. ${pct(infeasible / cells.length, 0)} of the map is infeasible (hatched): too little stock to hit the fill-rate target, or more than the ${fmt(capacity)}-unit storage capacity. ` +
    `The cheapest feasible region hugs the edge of the service constraint. Numbered dots show where BO chose to simulate, clustering there rather than wasting runs on the expensive corners; the star is its choice: reorder at ${fmt(o.bo.best.s)} and order ${fmt(o.bo.best.Q)} units.`
  );
}

export function tornadoStory(e: EngineResult): string {
  const t = e.tornado;
  const swing = (b: (typeof t.bars)[number]) => Math.abs(b.ropOptHigh - b.ropOptLow);
  const sorted = [...t.bars].sort((a, b) => swing(b) - swing(a));
  const top = sorted[0];
  const cost = t.bars.filter((b) => b.key === "h" || b.key === "p");
  const costSwing = Math.max(...cost.map(swing));
  return (
    `Moving each input 20% either way and re-optimising shows what really drives the reorder point. ${top.label} matters most: the cost-optimal ROP swings by ${fmt(swing(top))} units. ` +
    `${sorted[1].label} is next (${fmt(swing(sorted[1]))} units). ` +
    (costSwing < 0.02 * t.baseRopOpt
      ? `Holding and stockout costs barely move it (at most ${fmt(costSwing)} units) because the ${"fill-rate"} constraint, not cost, is what binds: the cheapest policy is the one that just meets the service target.`
      : `Cost assumptions also matter (up to ${fmt(costSwing)} units), so check holding and stockout costs with finance.`) +
    ` Bars show the cost-optimal ROP; the thin markers show the slide-formula ROP, which ignores costs entirely.`
  );
}

export function sweepStory(e: EngineResult): string {
  const s = e.sweeps;
  return `The starter notebook changes one input at a time with a fixed 200-unit safety stock. Every extra week of lead time adds ${fmt(e.effective.dHist)} units to the reorder point, yet the safety stock never reacts to risk, cost or service, which is why the baseline policies above miss the target. Bayesian optimisation replaces these ${s.leadTime.x.length + s.demand.x.length + s.safetyStock.x.length} manual what-ifs with a search for the cheapest policy that meets the constraints.`;
}

export function decisionStory(d: Decision, rop: number, Q: number, leadTime: number): string {
  if (d.status === "order") {
    return `Inventory position ${fmt(d.inventoryPosition)} is ${fmt(-d.headroom)} units below this week's reorder point (${fmt(rop)}). Order ${fmt(d.orderQty)} units now (the optimised quantity is ${fmt(Q)}). Even so, there is a ${pct(d.stockoutProb, 1)} chance of running short before it arrives in about ${fmt(leadTime, 1)} weeks; waiting a week would raise that to ${pct(d.stockoutProbIfWait, 1)}.`;
  }
  if (d.status === "watch") {
    return `Inventory position ${fmt(d.inventoryPosition)} is only ${fmt(d.headroom)} units above the reorder point (${fmt(rop)}), less than one week of forecast demand. No order yet, but expect to order next week. Stockout risk over a lead time is ${pct(d.stockoutProb, 1)}; on-hand stock covers ${fmt(d.weeksOfCover, 1)} weeks.`;
  }
  return `Healthy: inventory position ${fmt(d.inventoryPosition)} is ${fmt(d.headroom)} units above the reorder point (${fmt(rop)}). On-hand stock covers ${fmt(d.weeksOfCover, 1)} weeks of forecast demand and the stockout risk over a lead time is ${pct(d.stockoutProb, 2)}.`;
}

export function scenarioStory(sc: Scenario, e: EngineResult): string {
  if (sc.key === "normal") return `Normal conditions: lead time ${fmt(e.effective.L, 1)} weeks (sd ${fmt(e.effective.sigmaL, 1)}), forecast error ${fmt(e.effective.sigmaD, 1)} units/week.`;
  return `${sc.name}: ${sc.description} Effective lead time ${fmt(e.effective.L, 1)} weeks (sd ${fmt(e.effective.sigmaL, 1)}), forecast error ${fmt(e.effective.sigmaD, 1)} units/week.`;
}

/* ---------- Bullwhip Lab ---------- */

export function bullwhipHeadline(lab: LabResult): string {
  const a = lab.runs.baseline;
  const b = lab.runs.aiForecast;
  const c = lab.runs.aiRouting;
  const mA = a.stages.manufacturer.bullwhip;
  const mC = c.stages.manufacturer.bullwhip;
  const red = (1 - mC / mA) * 100;
  const save = a.totalCost - c.totalCost;
  return (
    `On the same ${a.weeks - a.warmup} weeks of real customer demand, the manufacturer's orders swing ${fmt(mA, 2)}x as much as customer demand in the baseline (variance ratio). ` +
    `AI forecasting brings that to ${fmt(b.stages.manufacturer.bullwhip, 2)}x, and adding AI routing leaves ${fmt(mC, 2)}x, ` +
    `so amplification at the manufacturer ${red >= 0 ? `falls by ${fmt(red, 0)}%` : `rises by ${fmt(-red, 0)}%`}. ` +
    `Total network cost falls from ${money(a.totalCost)} to ${money(c.totalCost)} (${save >= 0 ? `${money(save)} saved, ${fmt((save / a.totalCost) * 100, 1)}%` : `${money(-save)} more`}).`
  );
}

export function baseRunStory(lab: LabResult): string {
  const a = lab.runs.baseline.stages;
  return (
    `Every node forecasts from the orders it receives with a moving average and orders up to a target that includes safety stock sized from recent swings. ` +
    `Each tier sees a noisier signal than the one below and adds its own over-reaction, so variability grows upstream: ${fmt(a.retailer.bullwhip, 2)}x at the retailers, ${fmt(a.distributor.bullwhip, 2)}x at the distributors and ${fmt(a.manufacturer.bullwhip, 2)}x at the manufacturer. ` +
    `Nothing here multiplies demand by a fixed factor; the amplification comes from the ordering behaviour alone.` +
    (lab.shockWeeks ? ` The shaded demand shock (${lab.shockWeeks[0]} to ${lab.shockWeeks[1]}) shows the effect most clearly.` : "")
  );
}

export function aiForecastStory(lab: LabResult, sharing: boolean): string {
  const a = lab.runs.baseline.stages;
  const b = lab.runs.aiForecast.stages;
  const best = lab.retailers.map((r) => `${r.id} ${r.bestModel} (${fmt(r.wape, 1)}% WAPE)`).join(", ");
  return (
    `Retailers now order from the best out-of-sample ML forecast of their own customer demand: ${best}. ` +
    (sharing
      ? `With information sharing on, distributors and the manufacturer plan on the shared customer-demand forecast instead of reacting to the orders arriving from below. `
      : `Information sharing is off, so distributors and the manufacturer still react only to the orders arriving from below. `) +
    `The manufacturer's ratio moves from ${fmt(a.manufacturer.bullwhip, 2)}x to ${fmt(b.manufacturer.bullwhip, 2)}x and the distributors' from ${fmt(a.distributor.bullwhip, 2)}x to ${fmt(b.distributor.bullwhip, 2)}x.`
  );
}

export function routingStory(lab: LabResult, labels: string[]): string {
  const b = lab.runs.aiForecast;
  const c = lab.runs.aiRouting;
  const scored = c.weeks - c.warmup;
  const moved: string[] = [];
  for (let r = 0; r < labels.length; r++) {
    const fromB = b.laneVolume.map((row) => row[r]);
    const fromC = c.laneVolume.map((row) => row[r]);
    const mainB = fromB.indexOf(Math.max(...fromB));
    const mainC = fromC.indexOf(Math.max(...fromC));
    if (mainB !== mainC) moved.push(`${labels[r]} from Distributor ${mainB + 1} to Distributor ${mainC + 1}`);
  }
  const shipB = b.stages.distributor.shippingCost;
  const shipC = c.stages.distributor.shippingCost;
  return (
    `Each week a min-cost allocation decides how much each distributor ships to each retailer, trading lane shipping cost against backlog and holding cost, never shipping more than a distributor holds, and giving priority to retailers whose ML forecast says they will run short. ` +
    (moved.length ? `It re-plans the network: ${moved.join("; ")}. ` : "It keeps every retailer on its current distributor because the assigned lanes are already the cheapest. ") +
    `Shipping cost over ${scored} weeks moves from ${money(shipB)} to ${money(shipC)}, distributor fill rate from ${pct(b.stages.distributor.fillRate, 1)} to ${pct(c.stages.distributor.fillRate, 1)}, and total cost from ${money(b.totalCost)} to ${money(c.totalCost)}.`
  );
}
