/**
 * Offline training of the initial LSTM weights (one network per SKU).
 *
 * Uses exactly the module the browser uses (src/lib/forecast/lstm.ts), seeded, on the
 * initial history the dashboard opens with (all weeks except the held-back stream weeks),
 * and only on weeks before the 52-week test window. The browser loads these weights and
 * fine-tunes them as new weeks arrive.
 *
 * Usage: npm run train-lstm
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureBackend, LstmForecaster, LSTM_FULL_TRAIN, LSTM_UNITS, LSTM_WINDOW, type LstmWeights } from "../src/lib/forecast/lstm";
import { testStartFor } from "../src/lib/forecast/pipeline";
import type { DatasetFile } from "../src/lib/types";

export interface LstmWeightsFile {
  window: number;
  units: number;
  seed: number;
  skus: Record<string, { nRows: number; trainEnd: number; finalLoss: number; weights: LstmWeights }>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const LSTM_SEED = 42;

async function main(): Promise<void> {
  await ensureBackend();
  const data = JSON.parse(readFileSync(resolve(root, "public/data/skus.json"), "utf8")) as DatasetFile;
  const out: LstmWeightsFile = { window: LSTM_WINDOW, units: LSTM_UNITS, seed: LSTM_SEED, skus: {} };
  for (const sku of data.skus) {
    const rows = sku.rows.slice(0, sku.rows.length - data.holdoutWeeks);
    const trainEnd = testStartFor(rows.length);
    const started = Date.now();
    const net = new LstmForecaster(LSTM_SEED);
    const loss = await net.train(rows.map((r) => r.demand), rows, trainEnd, LSTM_FULL_TRAIN);
    out.skus[sku.id] = { nRows: rows.length, trainEnd, finalLoss: loss, weights: net.getWeights() };
    process.stdout.write(`SKU ${sku.id}: trained on weeks 0-${trainEnd - 1} (${rows.length} rows), loss ${loss.toFixed(5)}, ${((Date.now() - started) / 1000).toFixed(1)} s\n`);
    net.dispose();
  }
  mkdirSync(resolve(root, "public/models"), { recursive: true });
  writeFileSync(resolve(root, "public/models/lstm-weights.json"), JSON.stringify(out));
  process.stdout.write("wrote public/models/lstm-weights.json\n");
}

main().catch((err: unknown) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
