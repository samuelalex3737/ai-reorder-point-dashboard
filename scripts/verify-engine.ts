/**
 * Runs the forecast pipeline and inventory engine for every SKU under every scenario and
 * prints the key numbers and timings. Used to verify Parts 2 and 3.
 *
 * Usage: npx tsx scripts/verify-engine.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runEngine } from "../src/lib/engine/inventoryEngine";
import { defaultControls, FORECAST_HORIZON, futurePromoPlan, SCENARIO_KEYS, SCENARIOS } from "../src/lib/engine/params";
import { runPipeline } from "../src/lib/forecast/pipeline";
import { SKU_CATALOGUE } from "../src/lib/data/catalogue";
import type { DatasetFile } from "../src/lib/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(resolve(root, "public/data/skus.json"), "utf8")) as DatasetFile;
const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;

for (const sku of data.skus) {
  const rows = sku.rows.slice(0, sku.rows.length - data.holdoutWeeks);
  const promoRate = rows.reduce((a, r) => a + r.promoDays, 0) / rows.length;
  const controls = defaultControls(SKU_CATALOGUE.find((s) => s.id === sku.id)!.defaults);
  for (const key of SCENARIO_KEYS) {
    const scenario = SCENARIOS[key];
    const fc = runPipeline({ rows, basePrice: sku.basePrice, futurePromo: futurePromoPlan(scenario, promoRate, FORECAST_HORIZON), lstm: null });
    const t0 = Date.now();
    const r = runEngine({
      forecastMean: fc.forecast.map((f) => f.mean),
      sigmaD: fc.sigmaD,
      history: rows.map((x) => x.demand),
      unitPrice: sku.basePrice,
      controls,
      scenario,
    });
    const ms = Date.now() - t0;
    const e = r.effective;
    process.stdout.write(
      `\n[${sku.id} | ${scenario.name}] engine ${ms} ms | Dbar ${e.dBar.toFixed(1)} sigmaD ${e.sigmaD.toFixed(1)} L ${e.L} sigmaL ${e.sigmaL} | SS formula ${r.ss.formula.toFixed(1)} (LT share ${pct(r.ss.shares.leadTime)}) ROP ${r.ss.ropFormula.toFixed(1)} | ROP_MC ${r.mc.ropMC.toFixed(1)} | static SS ${r.ss.static.toFixed(1)} | EOQ ${e.eoq}\n`,
    );
    for (const p of r.policies) {
      process.stdout.write(
        `  ${p.name.padEnd(40)} s ${p.s.toFixed(0).padStart(5)} Q ${String(p.Q).padStart(5)} cost ${p.sim.annualCost.toFixed(0).padStart(8)} fill ${pct(p.sim.fillRate).padStart(6)} CSL ${pct(p.sim.cycleServiceLevel).padStart(6)} P(stockout wk) ${pct(p.sim.weeklyStockoutProb).padStart(6)} target ${p.targetMet ? "met" : "MISSED"}${p.capacityOk ? "" : " CAPACITY"}\n`,
      );
    }
    const o = r.optimisation;
    const boBest = o.bo.best.objective;
    const rsBest = o.random.at(-1)!.bestSoFar;
    const gBest = o.manual.at(-1)!.bestSoFar;
    process.stdout.write(`  BO best ${boBest.toFixed(0)} | random ${rsBest.toFixed(0)} | manual grid(42) ${gBest.toFixed(0)} | full grid(400) ${o.fullGridBest.objective.toFixed(0)} | BO gap ${o.gapPct.toFixed(2)}%\n`);
    const tb = r.tornado.bars.map((b) => `${b.key}: ${(b.ropOptLow - r.tornado.baseRopOpt).toFixed(0)}/${(b.ropOptHigh - r.tornado.baseRopOpt).toFixed(0)}`).join("  ");
    process.stdout.write(`  tornado (opt s delta low/high): ${tb}\n`);
  }
}
