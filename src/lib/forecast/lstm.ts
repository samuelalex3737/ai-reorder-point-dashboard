/**
 * LSTM demand forecaster (Hochreiter and Schmidhuber, 1997) on TensorFlow.js, CPU backend.
 *
 * Input: a 12-week window. Each time step k carries
 *   [demand(t-12+k) / windowMean - 1, promoDays(t-11+k) / 7, seasonSin(t-11+k), seasonCos(t-11+k)]
 * so the last step already contains the planned promotion and season of the target week t.
 * Target: demand(t) / windowMean - 1. Scaling by the window mean makes the network
 * level-free, so the same architecture works for fast and slow movers and copes with trend.
 *
 * Training is seeded (initialisers) and unshuffled, so it is deterministic on the CPU backend.
 * The same module trains the initial weights offline (scripts/train-lstm.ts) and fine-tunes
 * them in the browser worker when new data arrives.
 */
import * as tf from "@tensorflow/tfjs";
import { yearPhase } from "../calendar";
import type { ExoRow } from "./features";

import { LSTM_UNITS, LSTM_WINDOW } from "./lstmConfig";

export { LSTM_UNITS, LSTM_WINDOW };
const N_INPUT = 4;

export interface LstmWeights {
  shapes: number[][];
  values: number[][];
}

export interface LstmTrainOptions {
  epochs: number;
  learningRate: number;
  batchSize?: number;
  /** Progress callback after each epoch (used for the in-browser retrain progress bar). */
  onEpoch?: (epoch: number, loss: number) => void;
}

export const LSTM_FULL_TRAIN: LstmTrainOptions = { epochs: 120, learningRate: 0.01, batchSize: 16 };
export const LSTM_FINE_TUNE: LstmTrainOptions = { epochs: 12, learningRate: 0.003, batchSize: 16 };

let backendReady: Promise<void> | null = null;

/** Select the deterministic CPU backend once per thread. */
export function ensureBackend(): Promise<void> {
  if (!backendReady) {
    backendReady = (async () => {
      // IS_TEST silences the Node.js "install tfjs-node" advisory in offline scripts and tests.
      if (typeof process !== "undefined" && process.versions?.node) tf.env().set("IS_TEST", true);
      await tf.setBackend("cpu");
      await tf.ready();
    })();
  }
  return backendReady;
}

function stepFeatures(rows: ExoRow[], idx: number): [number, number, number] {
  const phase = 2 * Math.PI * yearPhase(rows[idx].week);
  return [rows[idx].promoDays / 7, Math.sin(phase), Math.cos(phase)];
}

/** Build one input window for target index t from demand[0..t-1] and exogenous rows[..t]. */
function windowFor(demand: ArrayLike<number>, rows: ExoRow[], t: number): { x: number[][]; scale: number } {
  let scale = 0;
  for (let k = t - LSTM_WINDOW; k < t; k++) scale += demand[k];
  scale = Math.max(scale / LSTM_WINDOW, 1e-6);
  const x: number[][] = [];
  for (let k = t - LSTM_WINDOW; k < t; k++) x.push([demand[k] / scale - 1, ...stepFeatures(rows, k + 1)]);
  return { x, scale };
}

export class LstmForecaster {
  private model: tf.LayersModel;

  constructor(seed = 42) {
    const model = tf.sequential();
    model.add(
      tf.layers.lstm({
        units: LSTM_UNITS,
        inputShape: [LSTM_WINDOW, N_INPUT],
        kernelInitializer: tf.initializers.glorotUniform({ seed }),
        recurrentInitializer: tf.initializers.glorotUniform({ seed: seed + 1 }),
      }),
    );
    model.add(tf.layers.dense({ units: 1, kernelInitializer: tf.initializers.glorotUniform({ seed: seed + 2 }) }));
    this.model = model;
  }

  /**
   * Train on all targets t in [LSTM_WINDOW, end): only weeks before `end` are seen.
   * Returns the final training loss (mean squared error on the scaled target).
   */
  async train(demand: ArrayLike<number>, rows: ExoRow[], end: number, opts: LstmTrainOptions): Promise<number> {
    const xs: number[][][] = [];
    const ys: number[] = [];
    for (let t = LSTM_WINDOW; t < end; t++) {
      const { x, scale } = windowFor(demand, rows, t);
      xs.push(x);
      ys.push(demand[t] / scale - 1);
    }
    this.model.compile({ optimizer: tf.train.adam(opts.learningRate), loss: "meanSquaredError" });
    const X = tf.tensor3d(xs);
    const Y = tf.tensor2d(ys, [ys.length, 1]);
    const hist = await this.model.fit(X, Y, {
      epochs: opts.epochs,
      batchSize: opts.batchSize ?? 16,
      shuffle: false,
      verbose: 0,
      callbacks: opts.onEpoch
        ? {
            onEpochEnd: (epoch: number, logs?: tf.Logs) => {
              opts.onEpoch?.(epoch + 1, logs?.loss ?? NaN);
            },
          }
        : undefined,
    });
    X.dispose();
    Y.dispose();
    const losses = hist.history.loss as number[];
    return losses[losses.length - 1];
  }

  /** One-step forecast for index t from demand[0..t-1]. */
  predict(demand: ArrayLike<number>, rows: ExoRow[], t: number): number {
    const { x, scale } = windowFor(demand, rows, t);
    const out = tf.tidy(() => (this.model.predict(tf.tensor3d([x])) as tf.Tensor).dataSync()[0]);
    return scale * (1 + out);
  }

  getWeights(): LstmWeights {
    const ws = this.model.getWeights();
    return {
      shapes: ws.map((w) => w.shape.slice()),
      values: ws.map((w) => Array.from(w.dataSync()).map((v) => Math.round(v * 1e7) / 1e7)),
    };
  }

  setWeights(weights: LstmWeights): void {
    const tensors = weights.values.map((v, i) => tf.tensor(v, weights.shapes[i]));
    this.model.setWeights(tensors);
    tensors.forEach((t) => t.dispose());
  }

  dispose(): void {
    this.model.dispose();
  }
}
