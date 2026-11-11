/**
 * Prints the out-of-sample leaderboard, sigma_D and timings for each SKU, using the same
 * pipeline and saved LSTM weights as the dashboard. Used to verify Part 1.
 *
 * Usage: npm run verify
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBackend, LstmForecaster } from "../src/lib/forecast/lstm";
import { MODEL_INFO, runPipeline } from "../src/lib/forecast/pipeline";
import type { DatasetFile } from "../src/lib/types";
import type { LstmWeightsFile } from "./train-lstm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main(): Promise<void> {
  await ensureBackend();
  const data = JSON.parse(readFileSync(resolve(root, "public/data/skus.json"), "utf8")) as DatasetFile;
  const weights = JSON.parse(readFileSync(resolve(root, "public/models/lstm-weights.json"), "utf8")) as LstmWeightsFile;
  for (const sku of data.skus) {
    const rows = sku.rows.slice(0, sku.rows.length - data.holdoutWeeks);
    const promoRate = rows.reduce((a, r) => a + r.promoDays, 0) / rows.length;
    const lstm = new LstmForecaster(weights.seed);
    lstm.setWeights(weights.skus[sku.id].weights);
    const t0 = Date.now();
    const res = runPipeline({ rows, basePrice: sku.basePrice, futurePromo: new Array(52).fill(promoRate), lstm });
    const ms = Date.now() - t0;
    process.stdout.write(`\n${sku.label} (${sku.store}/${sku.item}) - ${res.nRows} weeks, train rows ${res.trainRows}, test ${res.testWeeks[0]} to ${res.testWeeks.at(-1)}, pipeline ${ms} ms\n`);
    process.stdout.write("model                      MAPE%   WAPE%    RMSE   Bias%\n");
    for (const m of [...res.models].sort((a, b) => a.metrics.wape - b.metrics.wape)) {
      const x = m.metrics;
      process.stdout.write(
        `${MODEL_INFO[m.key].name.padEnd(24)} ${x.mape.toFixed(2).padStart(7)} ${x.wape.toFixed(2).padStart(7)} ${x.rmse.toFixed(1).padStart(7)} ${x.bias.toFixed(2).padStart(7)}${m.key === res.bestKey ? "  <- best" : ""}\n`,
      );
    }
    const f = res.forecast;
    process.stdout.write(`sigma_D = ${res.sigmaD.toFixed(2)} units/week; forecast wk1 ${f[0].mean.toFixed(1)} [80%: ${f[0].lo80.toFixed(1)}-${f[0].hi80.toFixed(1)}], wk13 ${f[12].mean.toFixed(1)}, wk52 ${f[51].mean.toFixed(1)}\n`);
    lstm.dispose();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
