/**
 * Orchestrator: watches the store and dispatches work to the two Web Workers.
 *  - Forecast worker reruns when the SKU's data, the scenario's promotion plan, or the LSTM
 *    retrain counter changes (results are cached per SKU).
 *  - Engine worker reruns (debounced) when the forecast, controls or scenario change.
 * It also writes the model version log.
 */
import { FORECAST_HORIZON, futurePromoPlan, SCENARIOS } from "../lib/engine/params";
import { MODEL_INFO } from "../lib/forecast/pipeline";
import type { VersionEntry } from "../lib/data/persistence";
import { savePersisted, type PersistedState } from "../lib/data/persistence";
import { CoalescingWorker } from "../workers/client";
import type { BullwhipRequest, BullwhipResponse, EngineRequest, EngineResponse, ForecastRequest, ForecastResponse, SkuId } from "../workers/protocol";
import { historyOf, lstmInitOf, skuSeries, SKU_IDS, useStore, type AppState } from "./store";

let started = false;

function promoPlanKey(s: AppState): string {
  const sc = SCENARIOS[s.scenarioKey];
  return `${sc.promoWeeks}x${sc.promoDaysPerWeek}`;
}

export function forecastKeyOf(s: AppState, id: SkuId = s.skuId): string {
  const k = s.skus[id];
  return `${id}|d${k.dataVersion}|m${k.modelNonce}|p${promoPlanKey(s)}`;
}

function engineKeyOf(s: AppState, fKey: string): string {
  return `${fKey}|${s.scenarioKey}|${JSON.stringify(s.skus[s.skuId].controls)}`;
}

function persistVersions(s: AppState): void {
  const out: PersistedState = {};
  for (const id of SKU_IDS) {
    const k = s.skus[id];
    out[id] = { added: k.added, cursor: k.cursor, dataVersion: k.dataVersion, versions: k.versions };
  }
  void savePersisted(out);
}

export function startOrchestrator(): void {
  if (started) return;
  started = true;
  const forecastWorker = new CoalescingWorker<ForecastRequest, ForecastResponse>(
    () => new Worker(new URL("../workers/forecast.worker.ts", import.meta.url), { type: "module" }),
  );
  const engineWorker = new CoalescingWorker<EngineRequest, EngineResponse>(
    () => new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" }),
  );
  const bullwhipWorker = new CoalescingWorker<BullwhipRequest, BullwhipResponse>(
    () => new Worker(new URL("../workers/engine.worker.ts", import.meta.url), { type: "module" }),
  );
  let inflightBw = "";
  let inflightForecast = "";
  let inflightEngine = "";
  let scheduledEngine = "";
  let engineTimer: ReturnType<typeof setTimeout> | null = null;

  const requestForecast = (s: AppState): void => {
    const id = s.skuId;
    const key = forecastKeyOf(s, id);
    if (s.forecasts[id]?.key === key || inflightForecast === key) return;
    inflightForecast = key;
    const series = skuSeries(s, id);
    const rows = historyOf(s, id);
    const expectedPromo = rows.reduce((a, r) => a + r.promoDays, 0) / rows.length;
    const k = s.skus[id];
    useStore.setState({ forecastBusy: true, workerError: null });
    forecastWorker.submit(
      {
        kind: "forecast",
        skuId: id,
        rows,
        basePrice: series.basePrice,
        futurePromo: futurePromoPlan(SCENARIOS[s.scenarioKey], expectedPromo, FORECAST_HORIZON),
        lstmInit: lstmInitOf(s, id),
        lstmMode: k.lstmMode,
      },
      {
        onProgress: (message, fraction) => useStore.setState({ progress: { message, fraction } }),
        onResult: (payload) => {
          inflightForecast = "";
          const cur = useStore.getState();
          const kk = cur.skus[id];
          const entry = { key, dataVersion: k.dataVersion, modelNonce: k.modelNonce, result: payload.result, lstm: payload.lstm, millis: payload.millis };
          const last = kk.versions[kk.versions.length - 1];
          let versions = kk.versions;
          if (!last || last.dataVersion !== k.dataVersion || last.modelNonce !== k.modelNonce) {
            const best = payload.result.models.find((m) => m.key === payload.result.bestKey)!;
            const v: VersionEntry = {
              version: (last?.version ?? 0) + 1,
              dataVersion: k.dataVersion,
              modelNonce: k.modelNonce,
              at: new Date().toISOString(),
              trigger: kk.pendingTrigger,
              rows: payload.result.nRows,
              lastWeek: rows[rows.length - 1].week,
              bestModel: MODEL_INFO[best.key].name,
              wape: best.metrics.wape,
              sigmaD: payload.result.sigmaD,
              rop: null,
              lstm: payload.lstm.status,
            };
            versions = [...kk.versions, v];
          }
          useStore.setState({
            forecasts: { ...cur.forecasts, [id]: entry },
            skus: { ...cur.skus, [id]: { ...kk, versions, lstmMode: "auto" } },
            forecastBusy: false,
            progress: null,
          });
          persistVersions(useStore.getState());
        },
        onError: (message) => {
          inflightForecast = "";
          useStore.setState({ forecastBusy: false, progress: null, workerError: `Forecast failed: ${message}` });
        },
      },
    );
  };

  const requestEngine = (s: AppState): void => {
    const id = s.skuId;
    const fc = s.forecasts[id];
    if (!fc || fc.key !== forecastKeyOf(s, id)) return;
    const key = engineKeyOf(s, fc.key);
    if (s.engine?.key === key || inflightEngine === key || scheduledEngine === key) return;
    scheduledEngine = key;
    if (engineTimer) clearTimeout(engineTimer);
    if (!s.engineBusy) useStore.setState({ engineBusy: true });
    engineTimer = setTimeout(() => {
      scheduledEngine = "";
      const st = useStore.getState();
      const f = st.forecasts[st.skuId];
      if (!f) return;
      const k2 = engineKeyOf(st, f.key);
      inflightEngine = k2;
      const series = skuSeries(st);
      engineWorker.submit(
        {
          kind: "engine",
          input: {
            forecastMean: f.result.forecast.map((p) => p.mean),
            sigmaD: f.result.sigmaD,
            history: historyOf(st).map((r) => r.demand),
            unitPrice: series.basePrice,
            controls: st.skus[st.skuId].controls,
            scenario: SCENARIOS[st.scenarioKey],
          },
        },
        {
          onResult: (payload) => {
            inflightEngine = "";
            const cur = useStore.getState();
            const kk = cur.skus[id];
            const last = kk.versions[kk.versions.length - 1];
            let skus = cur.skus;
            if (last && last.rop === null && last.dataVersion === f.dataVersion && last.modelNonce === f.modelNonce) {
              const versions = [...kk.versions.slice(0, -1), { ...last, rop: payload.result.dynamicRop[0].rop }];
              skus = { ...cur.skus, [id]: { ...kk, versions } };
            }
            useStore.setState({ engine: { key: k2, forecastKey: f.key, result: payload.result, millis: payload.millis }, engineBusy: false, skus });
            if (skus !== cur.skus) persistVersions(useStore.getState());
          },
          onError: (message) => {
            inflightEngine = "";
            useStore.setState({ engineBusy: false, workerError: `Optimisation failed: ${message}` });
          },
        },
      );
    }, 180);
  };

  const requestBullwhip = (s: AppState): void => {
    if (s.page !== "bullwhip" || !s.bullwhipData || !s.dataset) return;
    const key = JSON.stringify([s.bwConfig, s.bwShock]);
    if (s.bwResult?.key === key || inflightBw === key) return;
    inflightBw = key;
    if (!s.bwBusy) useStore.setState({ bwBusy: true });
    bullwhipWorker.submit(
      { kind: "bullwhip", input: { data: s.bullwhipData, holdoutWeeks: s.dataset.holdoutWeeks, config: s.bwConfig, shock: s.bwShock } },
      {
        onResult: (payload) => {
          inflightBw = "";
          useStore.setState({ bwResult: { key, result: payload.result, millis: payload.millis }, bwBusy: false });
        },
        onError: (message) => {
          inflightBw = "";
          useStore.setState({ bwBusy: false, workerError: `Bullwhip simulation failed: ${message}` });
        },
      },
    );
  };

  const tick = (): void => {
    const s = useStore.getState();
    if (s.status !== "ready") return;
    requestForecast(s);
    requestEngine(s);
    requestBullwhip(s);
  };
  useStore.subscribe(tick);
  tick();
}
