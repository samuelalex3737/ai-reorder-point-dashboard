/// <reference lib="webworker" />
/**
 * Optimisation worker. Handles two job kinds:
 *  - "engine": safety stock, Monte Carlo, simulator, Bayesian optimisation and tornado;
 *  - "bullwhip": the three Bullwhip Lab runs (forecasts, multi-echelon simulation, allocation LP).
 */
import { runLab } from "../lib/bullwhip/lab";
import { runEngine } from "../lib/engine/inventoryEngine";
import type { BullwhipRequest, BullwhipResponse, EngineRequest, EngineResponse, WorkerMessage } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = (ev: MessageEvent<{ id: number; request: EngineRequest | BullwhipRequest }>) => {
  const { id, request } = ev.data;
  const started = performance.now();
  try {
    if (request.kind === "bullwhip") {
      const msg: WorkerMessage<BullwhipResponse> = { type: "result", id, payload: { result: runLab(request.input), millis: performance.now() - started } };
      self.postMessage(msg);
    } else {
      const msg: WorkerMessage<EngineResponse> = { type: "result", id, payload: { result: runEngine(request.input), millis: performance.now() - started } };
      self.postMessage(msg);
    }
  } catch (err) {
    const msg: WorkerMessage<never> = { type: "error", id, message: err instanceof Error ? err.message : String(err) };
    self.postMessage(msg);
  }
};
