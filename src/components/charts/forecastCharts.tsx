/** Forecasting page charts: forecast vs actual with bands, and the model version trend. */
import { useMemo } from "react";
import { MODEL_INFO, type ModelKey, type PipelineResult } from "../../lib/forecast/pipeline";
import type { VersionEntry } from "../../lib/data/persistence";
import type { WeekRow } from "../../lib/types";
import { EChart, type ChartOption } from "./EChart";
import { axis, C, grid, legend, textStyle, tooltip } from "./theme";

interface ForecastChartProps {
  history: WeekRow[];
  result: PipelineResult;
  compareKey: ModelKey | null;
  horizon?: number;
}

export function ForecastChart({ history, result, compareKey, horizon = 52 }: ForecastChartProps) {
  const option = useMemo<ChartOption>(() => {
    const shown = history.slice(-130);
    const offset = history.length - shown.length;
    const fc = result.forecast.slice(0, horizon);
    const weeks = [...shown.map((r) => r.week), ...fc.map((f) => f.week)];
    const n = shown.length;
    const pad = (arr: (number | null)[], start: number): (number | null)[] => {
      const out: (number | null)[] = new Array(weeks.length).fill(null);
      arr.forEach((v, i) => {
        if (start + i >= 0 && start + i < out.length) out[start + i] = v;
      });
      return out;
    };
    const best = result.models.find((m) => m.key === result.bestKey)!;
    const testStartIdx = result.testStart - offset;
    // Bands drawn as stacked areas: an invisible lower line plus the band width.
    const lo95 = pad([history[history.length - 1].demand, ...fc.map((f) => f.lo95)], n - 1);
    const w95 = pad([0, ...fc.map((f) => f.hi95 - f.lo95)], n - 1);
    const lo80 = pad([history[history.length - 1].demand, ...fc.map((f) => f.lo80)], n - 1);
    const w80 = pad([0, ...fc.map((f) => f.hi80 - f.lo80)], n - 1);
    const series: Record<string, unknown>[] = [
      { name: "95% band", type: "line", data: lo95, stack: "b95", symbol: "none", lineStyle: { opacity: 0 }, itemStyle: { color: "rgba(56,189,248,0.35)" }, tooltip: { show: false }, silent: true },
      { name: "95% band", type: "line", data: w95, stack: "b95", symbol: "none", lineStyle: { opacity: 0 }, itemStyle: { color: "rgba(56,189,248,0.35)" }, areaStyle: { color: "rgba(56,189,248,0.10)" }, tooltip: { show: false }, silent: true },
      { name: "80% band", type: "line", data: lo80, stack: "b80", symbol: "none", lineStyle: { opacity: 0 }, itemStyle: { color: "rgba(56,189,248,0.6)" }, tooltip: { show: false }, silent: true },
      { name: "80% band", type: "line", data: w80, stack: "b80", symbol: "none", lineStyle: { opacity: 0 }, itemStyle: { color: "rgba(56,189,248,0.6)" }, areaStyle: { color: "rgba(56,189,248,0.20)" }, tooltip: { show: false }, silent: true },
      {
        name: "Actual demand",
        type: "line",
        data: pad(shown.map((r) => r.demand), 0),
        symbol: "none",
        lineStyle: { color: C.actual, width: 1.6 },
        itemStyle: { color: C.actual },
        markArea: {
          silent: true,
          itemStyle: { color: "rgba(167,139,250,0.07)" },
          label: { color: C.text, fontSize: 10, position: "insideTop" },
          data: [[{ name: "Out-of-sample test window", xAxis: weeks[Math.max(0, testStartIdx)] }, { xAxis: weeks[n - 1] }]],
        },
        markLine: {
          silent: true,
          symbol: "none",
          lineStyle: { color: "rgba(226,232,240,0.35)", type: "dashed" },
          label: { color: C.text, fontSize: 10, formatter: "Now" },
          data: [{ xAxis: weeks[n - 1] }],
        },
      },
      {
        name: `${MODEL_INFO[best.key].name} (best, one step ahead)`,
        type: "line",
        data: pad(best.testPred, testStartIdx),
        symbol: "none",
        lineStyle: { color: C.ai, width: 1.6 },
        itemStyle: { color: C.ai },
      },
      {
        name: "Forecast (best model)",
        type: "line",
        data: pad([history[history.length - 1].demand, ...fc.map((f) => f.mean)], n - 1),
        symbol: "none",
        lineStyle: { color: C.forecast, width: 2 },
        itemStyle: { color: C.forecast },
      },
    ];
    if (compareKey && compareKey !== best.key) {
      const m = result.models.find((x) => x.key === compareKey);
      if (m) {
        series.push({
          name: `${MODEL_INFO[m.key].name} (comparison)`,
          type: "line",
          data: pad([...m.testPred, ...m.futurePred.slice(0, horizon)], testStartIdx),
          symbol: "none",
          lineStyle: { color: C.baseline, width: 1.3, type: "dashed" },
          itemStyle: { color: C.baseline },
        });
      }
    }
    return {
      textStyle,
      tooltip,
      legend: { ...legend, data: ["Actual demand", series[5].name as string, "Forecast (best model)", "80% band", "95% band", ...(series[7] ? [series[7].name as string] : [])] },
      grid: grid({ top: 56 }),
      xAxis: { type: "category", data: weeks, boundaryGap: false, ...axis("Week starting (Monday)", { nameGap: 30 }) },
      yAxis: { type: "value", ...axis("Units per week", { nameGap: 46 }), scale: true },
      dataZoom: [{ type: "inside", start: 30, end: 100 }],
      series,
    };
  }, [history, result, compareKey, horizon]);
  return <EChart option={option} height={360} ariaLabel="Line chart of weekly demand, the best model's out-of-sample predictions and the forecast with 80% and 95% uncertainty bands" />;
}

export function VersionChart({ versions }: { versions: VersionEntry[] }) {
  const option = useMemo<ChartOption>(() => {
    const x = versions.map((v) => `v${v.version}`);
    return {
      textStyle,
      tooltip,
      legend,
      grid: grid({ right: 64 }),
      xAxis: { type: "category", data: x, ...axis("Model version", { nameGap: 30 }) },
      yAxis: [
        { type: "value", ...axis("WAPE (%)", { nameGap: 44 }), scale: true },
        { type: "value", ...axis("Units per week", { nameGap: 48 }), scale: true, splitLine: { show: false } },
      ],
      series: [
        { name: "Best-model WAPE (%)", type: "line", data: versions.map((v) => v.wape), itemStyle: { color: C.ai }, lineStyle: { color: C.ai } },
        { name: "sigma_D (units/wk)", type: "line", yAxisIndex: 1, data: versions.map((v) => v.sigmaD), itemStyle: { color: C.mc }, lineStyle: { color: C.mc } },
      ],
    };
  }, [versions]);
  return <EChart option={option} height={240} ariaLabel="Line chart of forecast error and sigma_D across model versions" />;
}
