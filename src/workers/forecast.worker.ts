/// <reference lib="webworker" />
/**
 * Forecast worker: runs the out-of-sample model comparison and forecast off the main thread,
 * and keeps one LSTM per SKU. The LSTM starts from the offline-trained weights, is fine-tuned
 * whenever new weeks move the training window forward, and can be retrained from scratch.
 */
import { ensureBackend, LstmForecaster, LSTM_FINE_TUNE, LSTM_FULL_TRAIN } from "../lib/forecast/lstm";
import { runPipeline, testStartFor } from "../lib/forecast/pipeline";
import type { WeekRow } from "../lib/types";
import type { ForecastRequest, ForecastResponse, LstmInfo, LstmStatus, WorkerMessage } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

interface LstmState {
  net: LstmForecaster;
  trainedEnd: number;
  /** Fingerprint of the demand the network was trained on (weeks before trainedEnd). */
  fingerprint: number;
  status: LstmStatus;
}

const states = new Map<string, LstmState>();

function fingerprint(rows: WeekRow[], end: number): number {
  let h = 0;
  for (let i = 0; i < end && i < rows.length; i++) h = (h * 31 + rows[i].demand * (i + 1) + rows[i].promoDays) % 2147483647;
  return h;
}

function post<T>(msg: WorkerMessage<T>): void {
  self.postMessage(msg);
}

async function prepareLstm(id: number, req: ForecastRequest): Promise<LstmInfo> {
  const started = performance.now();
  const rows = req.rows;
  const demand = rows.map((r) => r.demand);
  const testStart = testStartFor(rows.length);
  let st = states.get(req.skuId);
  let epochs = 0;
  let loss: number | null = null;

  const fresh = (): LstmState => {
    st?.net.dispose();
    const net = new LstmForecaster(42);
    net.setWeights(req.lstmInit.weights);
    const s: LstmState = { net, trainedEnd: req.lstmInit.trainEnd, fingerprint: fingerprint(rows, req.lstmInit.trainEnd), status: "offline weights" };
    states.set(req.skuId, s);
    return s;
  };

  if (req.lstmMode === "full") {
    st?.net.dispose();
    const net = new LstmForecaster(42);
    loss = await net.train(demand, rows, testStart, {
      ...LSTM_FULL_TRAIN,
      onEpoch: (e, l) => post({ type: "progress", id, message: `Retraining LSTM: epoch ${e}/${LSTM_FULL_TRAIN.epochs}, loss ${l.toFixed(5)}`, fraction: e / LSTM_FULL_TRAIN.epochs }),
    });
    epochs = LSTM_FULL_TRAIN.epochs;
    st = { net, trainedEnd: testStart, fingerprint: fingerprint(rows, testStart), status: "retrained in browser" };
    states.set(req.skuId, st);
  } else {
    if (!st || st.trainedEnd > testStart || fingerprint(rows, st.trainedEnd) !== st.fingerprint) st = fresh();
    if (testStart > st.trainedEnd) {
      post({ type: "progress", id, message: "Fine-tuning LSTM on the new weeks", fraction: 0 });
      const current = st;
      loss = await current.net.train(demand, rows, testStart, {
        ...LSTM_FINE_TUNE,
        onEpoch: (e) => post({ type: "progress", id, message: `Fine-tuning LSTM: epoch ${e}/${LSTM_FINE_TUNE.epochs}`, fraction: e / LSTM_FINE_TUNE.epochs }),
      });
      epochs = LSTM_FINE_TUNE.epochs;
      current.trainedEnd = testStart;
      current.fingerprint = fingerprint(rows, testStart);
      if (current.status === "offline weights") current.status = "fine-tuned in browser";
    }
  }
  return { status: st.status, trainedEnd: st.trainedEnd, epochsThisRun: epochs, finalLoss: loss, millis: performance.now() - started };
}

self.onmessage = async (ev: MessageEvent<{ id: number; request: ForecastRequest }>) => {
  const { id, request } = ev.data;
  const started = performance.now();
  try {
    await ensureBackend();
    const lstm = await prepareLstm(id, request);
    post({ type: "progress", id, message: "Comparing 7 models out of sample", fraction: 1 });
    const result = runPipeline({
      rows: request.rows,
      basePrice: request.basePrice,
      futurePromo: request.futurePromo,
      lstm: states.get(request.skuId)!.net,
    });
    post<ForecastResponse>({ type: "result", id, payload: { result, lstm, millis: performance.now() - started } });
  } catch (err) {
    post({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
};
