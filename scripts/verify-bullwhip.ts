/**
 * Prints the Bullwhip Lab results for the default settings, with and without a demand shock
 * and information sharing. Used to verify Part 6.
 *
 * Usage: npx tsx scripts/verify-bullwhip.ts
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SHOCK, defaultBullwhipConfig, RUN_KEYS, RUNS, runLab } from "../src/lib/bullwhip/lab";
import type { BullwhipFile, DatasetFile } from "../src/lib/types";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const data = JSON.parse(readFileSync(resolve(root, "public/data/bullwhip.json"), "utf8")) as BullwhipFile;
const ds = JSON.parse(readFileSync(resolve(root, "public/data/skus.json"), "utf8")) as DatasetFile;

for (const [label, shock, sharing] of [
  ["default", DEFAULT_SHOCK, true],
  ["shock +40%", { ...DEFAULT_SHOCK, enabled: true }, true],
  ["no info sharing", DEFAULT_SHOCK, false],
] as const) {
  const t0 = Date.now();
  const res = runLab({ data, holdoutWeeks: ds.holdoutWeeks, config: { ...defaultBullwhipConfig(), infoSharing: sharing }, shock });
  process.stdout.write(`\n== ${label} (${Date.now() - t0} ms) ==\n`);
  for (const r of res.retailers) process.stdout.write(`  ${r.id}: ${r.bestModel} WAPE ${r.wape.toFixed(2)}% sigma ${r.sigmaD.toFixed(1)}\n`);
  for (const k of RUN_KEYS) {
    const run = res.runs[k];
    const s = run.stages;
    process.stdout.write(
      `  ${RUNS[k].name.padEnd(34)} BW R ${s.retailer.bullwhip.toFixed(2)} D ${s.distributor.bullwhip.toFixed(2)} M ${s.manufacturer.bullwhip.toFixed(2)} | cost ${run.totalCost.toFixed(0)} (R ${s.retailer.totalCost.toFixed(0)} D ${s.distributor.totalCost.toFixed(0)} M ${s.manufacturer.totalCost.toFixed(0)}) | fill R ${(s.retailer.fillRate * 100).toFixed(1)}% D ${(s.distributor.fillRate * 100).toFixed(1)}% M ${(s.manufacturer.fillRate * 100).toFixed(1)}% | lanes ${run.laneVolume.map((r) => r.map((v) => v.toFixed(0)).join("/")).join(" ; ")}\n`,
    );
  }
}
