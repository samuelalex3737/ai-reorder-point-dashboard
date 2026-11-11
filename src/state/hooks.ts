/** Convenience selectors for the current SKU, its forecast and the matching engine result. */
import { useMemo } from "react";
import type { EngineEntry, ForecastEntry, SkuState } from "./store";
import { historyOf, skuSeries, useStore } from "./store";
import { forecastKeyOf } from "./orchestrator";
import type { SkuSeries, WeekRow } from "../lib/types";

export function useSku(): { series: SkuSeries; state: SkuState; history: WeekRow[] } {
  const skuId = useStore((s) => s.skuId);
  const dataset = useStore((s) => s.dataset);
  const state = useStore((s) => s.skus[s.skuId]);
  const series = useMemo(() => dataset!.skus.find((x) => x.id === skuId)!, [dataset, skuId]);
  const history = useMemo(() => historyOf(useStore.getState(), skuId), [skuId, state.added, dataset]);
  return { series, state, history };
}

/** Latest forecast for the current SKU, and whether a newer one is being computed. */
export function useForecast(): { entry: ForecastEntry | undefined; stale: boolean } {
  const entry = useStore((s) => s.forecasts[s.skuId]);
  const currentKey = useStore((s) => forecastKeyOf(s));
  return { entry, stale: !entry || entry.key !== currentKey };
}

/** Engine result for the current SKU (null while the first one is computing). */
export function useEngine(): { entry: EngineEntry | null; stale: boolean } {
  const engine = useStore((s) => s.engine);
  const skuId = useStore((s) => s.skuId);
  const busy = useStore((s) => s.engineBusy || s.forecastBusy);
  const matches = engine && engine.forecastKey.startsWith(`${skuId}|`) ? engine : null;
  return { entry: matches, stale: busy };
}

export function useSeriesLabel(): string {
  const { series } = useSku();
  return series.label;
}

export { skuSeries };
