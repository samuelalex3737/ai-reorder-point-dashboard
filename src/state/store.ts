/**
 * Application state (Zustand). Holds the data per SKU, the controls, the scenario, and the
 * latest worker results. All heavy computation happens in the workers (see orchestrator.ts).
 */
import { create } from "zustand";
import type { EngineResult } from "../lib/engine/inventoryEngine";
import { defaultControls, SCENARIOS, type Controls, type ScenarioKey } from "../lib/engine/params";
import type { PipelineResult } from "../lib/forecast/pipeline";
import { estimatePromoDiscount } from "../lib/forecast/pipeline";
import { simulateNextWeek } from "../lib/data/intake";
import { clearPersisted, loadPersisted, savePersisted, type PersistedState, type VersionEntry } from "../lib/data/persistence";
import type { BullwhipFile, DatasetFile, SkuSeries, WeekRow } from "../lib/types";
import { DEFAULT_SHOCK, defaultBullwhipConfig, type LabResult, type RunKey, type ShockConfig } from "../lib/bullwhip/lab";
import type { BullwhipConfig, StageKey, StageParams } from "../lib/bullwhip/simulate";
import type { LstmInfo, LstmInit, SkuId } from "../workers/protocol";

export type PageKey = "control" | "forecast" | "risk" | "optimise" | "bullwhip" | "method";

export interface DecisionInputs {
  onHand: number;
  onOrder: number;
  backorders: number;
}

export interface SkuState {
  /** Weeks added after the initial history (streamed, uploaded or entered). */
  added: WeekRow[];
  /** Held-back real weeks already released by "Stream next period". */
  cursor: number;
  dataVersion: number;
  versions: VersionEntry[];
  controls: Controls;
  decision: DecisionInputs | null;
  /** Bumped by "Retrain LSTM" so the forecast reruns and a version is logged. */
  modelNonce: number;
  lstmMode: "auto" | "full";
  pendingTrigger: string;
}

export interface ForecastEntry {
  key: string;
  dataVersion: number;
  modelNonce: number;
  result: PipelineResult;
  lstm: LstmInfo;
  millis: number;
}

export interface EngineEntry {
  key: string;
  forecastKey: string;
  result: EngineResult;
  millis: number;
}

interface LstmWeightsFile {
  seed: number;
  skus: Record<string, { trainEnd: number; weights: LstmInit["weights"] }>;
}

export interface AppState {
  status: "loading" | "ready" | "error";
  loadError: string | null;
  dataset: DatasetFile | null;
  lstmFile: LstmWeightsFile | null;
  skuId: SkuId;
  page: PageKey;
  scenarioKey: ScenarioKey;
  skus: Record<SkuId, SkuState>;
  forecasts: Partial<Record<SkuId, ForecastEntry>>;
  engine: EngineEntry | null;
  forecastBusy: boolean;
  engineBusy: boolean;
  progress: { message: string; fraction: number } | null;
  workerError: string | null;
  controlsOpen: boolean;
  bullwhipData: BullwhipFile | null;
  bwConfig: BullwhipConfig;
  bwShock: ShockConfig;
  bwResult: { key: string; result: LabResult; millis: number } | null;
  bwBusy: boolean;
  bwView: RunKey;

  init: () => Promise<void>;
  setSku: (id: SkuId) => void;
  setPage: (p: PageKey) => void;
  setScenario: (k: ScenarioKey) => void;
  setControl: <K extends keyof Controls>(key: K, value: Controls[K]) => void;
  resetControls: () => void;
  setDecision: (d: DecisionInputs) => void;
  addRows: (rows: WeekRow[], trigger: string) => void;
  streamNext: () => { ok: boolean; message: string };
  undoLast: () => void;
  resetData: () => Promise<void>;
  retrainLstm: () => void;
  setControlsOpen: (open: boolean) => void;
  setBwConfig: (patch: Partial<BullwhipConfig>) => void;
  setBwStage: (stage: StageKey, patch: Partial<StageParams>) => void;
  setBwLane: (d: number, r: number, cost: number) => void;
  setBwShock: (patch: Partial<ShockConfig>) => void;
  resetBw: () => void;
  setBwView: (k: RunKey) => void;
}

export const SKU_IDS: SkuId[] = ["A", "B", "C"];

export function skuSeries(s: AppState, id: SkuId = s.skuId): SkuSeries {
  return s.dataset!.skus.find((x) => x.id === id)!;
}

/** Current demand history for a SKU: initial dataset weeks plus everything added since. */
export function historyOf(s: AppState, id: SkuId = s.skuId): WeekRow[] {
  const ds = s.dataset!;
  const series = skuSeries(s, id);
  return [...series.rows.slice(0, series.rows.length - ds.holdoutWeeks), ...s.skus[id].added];
}

export function lstmInitOf(s: AppState, id: SkuId): LstmInit {
  const w = s.lstmFile!.skus[id];
  return { weights: w.weights, trainEnd: w.trainEnd };
}

function freshSku(series: SkuSeries): SkuState {
  return {
    added: [],
    cursor: 0,
    dataVersion: 0,
    versions: [],
    controls: defaultControls(series.defaults),
    decision: null,
    modelNonce: 0,
    lstmMode: "auto",
    pendingTrigger: "Initial dataset",
  };
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out: PersistedState = {};
    for (const id of SKU_IDS) {
      const k = state.skus[id];
      out[id] = { added: k.added, cursor: k.cursor, dataVersion: k.dataVersion, versions: k.versions };
    }
    void savePersisted(out);
  }, 300);
}

export const useStore = create<AppState>((set, get) => {
  const updateSku = (id: SkuId, patch: Partial<SkuState> | ((k: SkuState) => Partial<SkuState>)): void => {
    set((s) => {
      const cur = s.skus[id];
      const p = typeof patch === "function" ? patch(cur) : patch;
      return { skus: { ...s.skus, [id]: { ...cur, ...p } } };
    });
  };

  return {
    status: "loading",
    loadError: null,
    dataset: null,
    lstmFile: null,
    skuId: "A",
    page: "control",
    scenarioKey: "normal",
    skus: {} as Record<SkuId, SkuState>,
    forecasts: {},
    engine: null,
    forecastBusy: false,
    engineBusy: false,
    progress: null,
    workerError: null,
    controlsOpen: false,
    bullwhipData: null,
    bwConfig: defaultBullwhipConfig(),
    bwShock: { ...DEFAULT_SHOCK },
    bwResult: null,
    bwBusy: false,
    bwView: "baseline",

    init: async () => {
      try {
        const [dsRes, wRes, bwRes] = await Promise.all([fetch("/data/skus.json"), fetch("/models/lstm-weights.json"), fetch("/data/bullwhip.json")]);
        if (!dsRes.ok || !wRes.ok || !bwRes.ok) throw new Error("Could not load the dataset or model weights.");
        const bullwhipData = (await bwRes.json()) as BullwhipFile;
        const dataset = (await dsRes.json()) as DatasetFile;
        const lstmFile = (await wRes.json()) as LstmWeightsFile;
        const persisted = await loadPersisted();
        const skus = {} as Record<SkuId, SkuState>;
        for (const series of dataset.skus) {
          const id = series.id as SkuId;
          const base = freshSku(series);
          const p = persisted?.[id];
          skus[id] = p ? { ...base, added: p.added, cursor: p.cursor, dataVersion: p.dataVersion, versions: p.versions, pendingTrigger: "Restored session" } : base;
        }
        set({ dataset, lstmFile, skus, bullwhipData, status: "ready" });
      } catch (err) {
        set({ status: "error", loadError: err instanceof Error ? err.message : String(err) });
      }
    },

    setSku: (id) => set({ skuId: id }),
    setPage: (p) => {
      set({ page: p });
      if (typeof window !== "undefined") window.scrollTo({ top: 0 });
    },
    setScenario: (k) => set({ scenarioKey: k }),
    setControl: (key, value) => {
      const id = get().skuId;
      updateSku(id, (k) => ({ controls: { ...k.controls, [key]: value } }));
    },
    resetControls: () => {
      const s = get();
      updateSku(s.skuId, { controls: defaultControls(skuSeries(s).defaults) });
      set({ scenarioKey: "normal" });
    },
    setDecision: (d) => updateSku(get().skuId, { decision: d }),
    setControlsOpen: (open) => set({ controlsOpen: open }),

    addRows: (rows, trigger) => {
      if (!rows.length) return;
      const id = get().skuId;
      updateSku(id, (k) => ({ added: [...k.added, ...rows], dataVersion: k.dataVersion + 1, pendingTrigger: trigger, lstmMode: "auto" }));
      persist(get());
    },

    streamNext: () => {
      const s = get();
      const id = s.skuId;
      const ds = s.dataset!;
      const series = skuSeries(s);
      const k = s.skus[id];
      const history = historyOf(s);
      // Real held-back weeks continue the history only while nothing else has been appended;
      // after an upload or manual entry the stream switches to simulated weeks.
      if (k.cursor < ds.holdoutWeeks && k.added.every((r) => r.source === "stream-real")) {
        const real = series.rows[series.rows.length - ds.holdoutWeeks + k.cursor];
        updateSku(id, (cur) => ({
          added: [...cur.added, { ...real, source: "stream-real" }],
          cursor: cur.cursor + 1,
          dataVersion: cur.dataVersion + 1,
          pendingTrigger: `Streamed real week ${real.week}`,
          lstmMode: "auto",
        }));
        persist(get());
        return { ok: true, message: `Released real week ${real.week} (${real.demand} units).` };
      }
      const fc = s.forecasts[id];
      if (!fc) return { ok: false, message: "Wait for the forecast to finish before streaming." };
      const expectedPromo = history.reduce((a, r) => a + r.promoDays, 0) / history.length;
      const row = simulateNextWeek(history, fc.result.forecast[0].mean, expectedPromo, fc.result.residuals, series.basePrice, estimatePromoDiscount(history, series.basePrice));
      updateSku(id, (cur) => ({ added: [...cur.added, row], dataVersion: cur.dataVersion + 1, pendingTrigger: `Simulated week ${row.week}`, lstmMode: "auto" }));
      persist(get());
      return { ok: true, message: `Real weeks used up: simulated week ${row.week} (${row.demand} units) from the best model plus a bootstrapped error.` };
    },

    undoLast: () => {
      const id = get().skuId;
      const k = get().skus[id];
      if (!k.added.length) return;
      const removed = k.added[k.added.length - 1];
      updateSku(id, {
        added: k.added.slice(0, -1),
        cursor: removed.source === "stream-real" ? k.cursor - 1 : k.cursor,
        dataVersion: k.dataVersion + 1,
        pendingTrigger: `Removed week ${removed.week}`,
        lstmMode: "auto",
      });
      persist(get());
    },

    resetData: async () => {
      const s = get();
      const skus = { ...s.skus };
      for (const id of SKU_IDS) {
        const series = skuSeries(s, id);
        skus[id] = { ...freshSku(series), controls: s.skus[id].controls, dataVersion: s.skus[id].dataVersion + 1, pendingTrigger: "Reset to dataset" };
      }
      set({ skus, forecasts: {}, engine: null });
      await clearPersisted();
    },

    setBwConfig: (patch) => set((s) => ({ bwConfig: { ...s.bwConfig, ...patch } })),
    setBwStage: (stage, patch) => set((s) => ({ bwConfig: { ...s.bwConfig, [stage]: { ...s.bwConfig[stage], ...patch } } })),
    setBwLane: (d, r, cost) =>
      set((s) => ({ bwConfig: { ...s.bwConfig, laneCost: s.bwConfig.laneCost.map((row, i) => row.map((v, j) => (i === d && j === r ? cost : v))) } })),
    setBwShock: (patch) => set((s) => ({ bwShock: { ...s.bwShock, ...patch } })),
    resetBw: () => set({ bwConfig: defaultBullwhipConfig(), bwShock: { ...DEFAULT_SHOCK } }),
    setBwView: (k) => set({ bwView: k }),

    retrainLstm: () => {
      updateSku(get().skuId, (k) => ({ modelNonce: k.modelNonce + 1, lstmMode: "full", pendingTrigger: "LSTM retrained from scratch" }));
    },
  };
});

export function scenarioOf(s: AppState) {
  return SCENARIOS[s.scenarioKey];
}
