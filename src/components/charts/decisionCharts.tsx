/** Control tower charts: policy cost comparison and dynamic vs flat reorder point. */
import { useMemo } from "react";
import type { EngineResult } from "../../lib/engine/inventoryEngine";
import type { ForecastPoint } from "../../lib/forecast/pipeline";
import { fmt } from "../../lib/format";
import { EChart, type ChartOption } from "./EChart";
import { axis, C, grid, legend, textStyle, tooltip } from "./theme";

const SHORT: Record<string, string> = {
  fixed: "Baseline\nfixed SS",
  static: "Baseline\nstatic SS",
  dynamic: "AI dynamic\nSS",
  monteCarlo: "AI Monte\nCarlo ROP",
  bayes: "AI Bayesian\noptimised",
};

export function PolicyCostChart({ engine, targetFill }: { engine: EngineResult; targetFill: number }) {
  const option = useMemo<ChartOption>(() => {
    const ps = engine.policies;
    return {
      textStyle,
      tooltip,
      legend,
      grid: grid({ right: 64, top: 56, bottom: 64 }),
      xAxis: { type: "category", data: ps.map((p) => SHORT[p.key]), ...axis("", {}), axisLabel: { color: C.text, fontSize: 10.5, interval: 0 } },
      yAxis: [
        { type: "value", ...axis("Annual cost ($)", { nameGap: 50 }) },
        { type: "value", ...axis("Fill rate (%)", { nameGap: 40 }), min: Math.min(80, Math.floor(Math.min(...ps.map((p) => p.sim.fillRate * 100)) / 5) * 5), max: 100, splitLine: { show: false } },
      ],
      series: [
        { name: "Holding", type: "bar", stack: "cost", data: ps.map((p) => p.sim.holding), itemStyle: { color: "rgba(56,189,248,0.75)" }, barWidth: "46%" },
        { name: "Stockout", type: "bar", stack: "cost", data: ps.map((p) => p.sim.shortage), itemStyle: { color: "rgba(244,63,94,0.8)" } },
        { name: "Ordering", type: "bar", stack: "cost", data: ps.map((p) => p.sim.ordering), itemStyle: { color: "rgba(167,139,250,0.75)" } },
        {
          name: "Fill rate (%)",
          type: "line",
          yAxisIndex: 1,
          data: ps.map((p) => p.sim.fillRate * 100),
          symbolSize: 9,
          lineStyle: { color: C.ai, width: 0 },
          itemStyle: { color: C.ai },
          markLine: { symbol: "none", silent: true, lineStyle: { color: C.ai, type: "dashed" }, label: { color: C.ai, fontSize: 10, formatter: `Target ${fmt(targetFill * 100, 1)}%` }, data: [{ yAxis: targetFill * 100 }] },
        },
      ],
    };
  }, [engine, targetFill]);
  return <EChart option={option} height={320} ariaLabel="Stacked bar chart of annual holding, stockout and ordering cost per policy, with fill rate markers against the target" />;
}

export function DynamicRopChart({ engine, forecast, weeks = 26 }: { engine: EngineResult; forecast: ForecastPoint[]; weeks?: number }) {
  const option = useMemo<ChartOption>(() => {
    const d = engine.dynamicRop.slice(0, weeks);
    const x = forecast.slice(0, weeks).map((f) => f.week);
    return {
      textStyle,
      tooltip,
      legend,
      grid: grid({ right: 64, top: 56 }),
      xAxis: { type: "category", data: x, ...axis("Week starting", { nameGap: 30 }) },
      yAxis: [
        { type: "value", ...axis("Reorder point (units)", { nameGap: 50 }), scale: true },
        { type: "value", ...axis("Forecast demand (units/week)", { nameGap: 48 }), splitLine: { show: false } },
      ],
      series: [
        { name: "Forecast demand", type: "bar", yAxisIndex: 1, data: engine.demandPath.slice(0, weeks), itemStyle: { color: "rgba(56,189,248,0.18)" }, barWidth: "60%" },
        { name: "AI adaptive ROP", type: "line", data: d.map((p) => p.rop), symbolSize: 6, lineStyle: { color: C.ai, width: 2.4 }, itemStyle: { color: C.ai }, areaStyle: { color: "rgba(45,212,191,0.06)" } },
        { name: "Baseline static ROP", type: "line", data: d.map(() => engine.ss.ropStatic), symbol: "none", lineStyle: { color: C.baseline, width: 2 }, itemStyle: { color: C.baseline } },
        { name: "Baseline fixed SS ROP", type: "line", data: d.map(() => engine.ss.ropFixed), symbol: "none", lineStyle: { color: C.baseline, width: 1.4, type: "dashed" }, itemStyle: { color: C.baseline } },
      ],
    };
  }, [engine, forecast, weeks]);
  return <EChart option={option} height={320} ariaLabel="Line chart of the adaptive weekly reorder point against the flat baseline reorder points, with forecast demand bars" />;
}
