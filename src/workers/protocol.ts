/** Message types exchanged with the Web Workers. */
import type { LabInput, LabResult } from "../lib/bullwhip/lab";
import type { EngineInput, EngineResult } from "../lib/engine/inventoryEngine";
import type { LstmWeights } from "../lib/forecast/lstm";
import type { PipelineResult } from "../lib/forecast/pipeline";
import type { WeekRow } from "../lib/types";

export type SkuId = "A" | "B" | "C";

export interface LstmInit {
  weights: LstmWeights;
  /** First test-window index the initial weights were trained up to (exclusive). */
  trainEnd: number;
}

export interface ForecastRequest {
  kind: "forecast";
  skuId: SkuId;
  rows: WeekRow[];
  basePrice: number;
  futurePromo: number[];
  lstmInit: LstmInit;
  /** "auto": load or fine-tune as needed; "full": retrain the LSTM from scratch first. */
  lstmMode: "auto" | "full";
}

export type LstmStatus = "offline weights" | "fine-tuned in browser" | "retrained in browser";

export interface LstmInfo {
  status: LstmStatus;
  trainedEnd: number;
  epochsThisRun: number;
  finalLoss: number | null;
  millis: number;
}

export interface ForecastResponse {
  result: PipelineResult;
  lstm: LstmInfo;
  millis: number;
}

export interface ProgressMessage {
  type: "progress";
  id: number;
  message: string;
  fraction: number;
}

export interface ResultMessage<T> {
  type: "result";
  id: number;
  payload: T;
}

export interface ErrorMessage {
  type: "error";
  id: number;
  message: string;
}

export type WorkerMessage<T> = ProgressMessage | ResultMessage<T> | ErrorMessage;

export interface EngineRequest {
  kind: "engine";
  input: EngineInput;
}

export interface EngineResponse {
  result: EngineResult;
  millis: number;
}

export interface BullwhipRequest {
  kind: "bullwhip";
  input: LabInput;
}

export interface BullwhipResponse {
  result: LabResult;
  millis: number;
}
