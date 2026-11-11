/** Optimisation page charts: convergence, cost landscape heatmap, tornado, baseline sweeps. */
import { useMemo } from "react";
import type { EngineResult } from "../../lib/engine/inventoryEngine";
import { fmt, money } from "../../lib/format";
import { EChart, type ChartOption } from "./EChart";
import { axis, C, grid, legend, textStyle, tooltip } from "./theme";

export function ConvergenceChart({ engine }: { engine: EngineResult }) {
  const option = useMemo<ChartOption>(() => {
    const o = engine.optimisation;
    const n = Math.max(o.bo.evaluations.length, o.random.length, o.manual.length);
    const x = Array.from({ length: n }, (_, i) => i + 1);
    const ref = o.fullGridBest.objective;
    const series = (name: string, vals: number[], color: string, dash?: string) => ({
      name,
      type: "line",
      step: "end",
      data: vals,
      symbol: "none",
      lineStyle: { color, width: 2.2, type: dash ?? "solid" },
      itemStyle: { color },
    });
    return {
      textStyle,
      tooltip: { ...tooltip, valueFormatter: (v: unknown) => money(Number(v)) },
      legend,
      grid: grid({ left: 74, top: 56 }),
      xAxis: { type: "category", data: x, ...axis("Simulator evaluations used", { nameGap: 30 }), boundaryGap: false },
      yAxis: {
        type: "value",
        ...axis("Best cost found so far ($/year, incl. penalties)", { nameGap: 60 }),
        min: (v: { min: number }) => Math.floor(Math.min(v.min, ref) * 0.995),
        max: (v: { max: number }) => Math.ceil(Math.min(v.max, ref * 1.25)),
        axisLabel: { color: C.text, fontSize: 10, formatter: (v: number) => `$${fmt(v / 1000)}k` },
      },
      series: [
        {
          ...series("Bayesian optimisation (GP + EI)", o.bo.evaluations.map((e) => e.bestSoFar), C.ai),
          markLine: {
            symbol: "none",
            silent: true,
            lineStyle: { color: "rgba(226,232,240,0.45)", type: "dotted" },
            label: { color: C.text, fontSize: 10, formatter: `Full 400-point grid: ${money(ref)}` },
            data: [{ yAxis: ref }],
          },
        },
        series("Random search", o.random.map((e) => e.bestSoFar), C.random, "dashed"),
        series("Manual grid sweep (7 x 6)", o.manual.map((e) => e.bestSoFar), C.baseline),
      ],
    };
  }, [engine]);
  return <EChart option={option} height={330} ariaLabel="Line chart of the best cost found against the number of evaluations for Bayesian optimisation, random search and a manual grid sweep" />;
}

export function CostHeatmap({ engine, mode }: { engine: EngineResult; mode: "simulated" | "surrogate" }) {
  const option = useMemo<ChartOption>(() => {
    const o = engine.optimisation;
    const xs = o.gridS.map((v) => fmt(v));
    const ys = o.gridQ.map((v) => fmt(v));
    const feasible: [number, number, number][] = [];
    const infeasible: [number, number, number][] = [];
    o.heat.forEach((row, j) =>
      row.forEach((c, i) => {
        const v = mode === "simulated" ? c.cost : o.bo.surrogate[j][i];
        (c.feasible ? feasible : infeasible).push([i, j, v]);
      }),
    );
    const fv = feasible.map((d) => d[2]).sort((a, b) => a - b);
    const lo = fv[0] ?? 0;
    const hi = fv[Math.floor(fv.length * 0.9)] ?? lo + 1;
    const ds = (o.gridS[1] - o.gridS[0]) / 2;
    const dq = (o.gridQ[1] - o.gridQ[0]) / 2;
    const pts = o.bo.evaluations.map((e) => ({ value: [e.s, e.Q, e.iteration], itemStyle: { color: e.phase === "warm" ? C.baseline : e.feasible ? "#F8FAFC" : "#94A3B8" } }));
    return {
      textStyle,
      tooltip: {
        backgroundColor: "rgba(10,15,28,0.94)",
        borderColor: "rgba(255,255,255,0.12)",
        textStyle: { color: "#E2E8F0", fontSize: 12 },
        formatter: (p: unknown) => {
          const q = p as { seriesName: string; value: number[] };
          if (q.seriesName.startsWith("BO")) return `BO evaluation ${q.value[2]}<br/>s = ${fmt(q.value[0])}, Q = ${fmt(q.value[1])}`;
          if (q.seriesName.startsWith("Chosen")) return `BO choice<br/>s = ${fmt(q.value[0])}, Q = ${fmt(q.value[1])}`;
          const cell = o.heat[q.value[1]][q.value[0]];
          return `s = ${fmt(cell.s)}, Q = ${fmt(cell.Q)}<br/>Annual cost ${money(cell.cost)}<br/>Fill rate ${(cell.fillRate * 100).toFixed(1)}%<br/>${cell.feasible ? "Feasible" : "Infeasible"}`;
        },
      },
      grid: grid({ left: 70, right: 96, top: 24, bottom: 56 }),
      xAxis: [
        { type: "category", data: xs, ...axis("Reorder point s (units)", { nameGap: 32 }), splitArea: { show: false }, axisLabel: { color: C.text, fontSize: 10, interval: 3 } },
        { type: "value", min: o.gridS[0] - ds, max: o.gridS[o.gridS.length - 1] + ds, show: false },
      ],
      yAxis: [
        { type: "category", data: ys, ...axis("Order quantity Q (units)", { nameGap: 52 }), axisLabel: { color: C.text, fontSize: 10, interval: 3 } },
        { type: "value", min: o.gridQ[0] - dq, max: o.gridQ[o.gridQ.length - 1] + dq, show: false },
      ],
      visualMap: [
        {
          min: lo,
          max: hi,
          seriesIndex: 0,
          calculable: false,
          orient: "vertical",
          right: 4,
          top: "middle",
          itemHeight: 160,
          text: ["High cost", "Low"],
          textStyle: { color: C.text, fontSize: 10 },
          inRange: { color: ["#0f766e", "#2DD4BF", "#FDE68A", "#F59E0B", "#E11D48"] },
          formatter: (v: number) => `$${fmt(v / 1000)}k`,
        },
        { show: false, seriesIndex: 1, min: 0, max: Math.max(1, hi), inRange: { color: ["rgba(51,65,85,0.9)", "rgba(51,65,85,0.9)"] } },
      ],
      series: [
        { name: "Feasible cost", type: "heatmap", data: feasible, emphasis: { itemStyle: { borderColor: "#fff", borderWidth: 1 } } },
        {
          name: "Infeasible",
          type: "heatmap",
          data: infeasible,
          itemStyle: { borderColor: "rgba(148,163,184,0.25)", borderWidth: 0.5, decal: { symbol: "rect", dashArrayX: [1, 0], dashArrayY: [2, 4], rotation: Math.PI / 4, color: "rgba(148,163,184,0.35)" } },
        },
        {
          name: "BO evaluations",
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: pts,
          symbolSize: 13,
          label: { show: true, formatter: (p: { value: number[] }) => String(p.value[2]), color: "#0a0f1c", fontSize: 8, fontWeight: 700 },
          itemStyle: { borderColor: "#0a0f1c", borderWidth: 1 },
          z: 5,
        },
        {
          name: "Chosen policy",
          type: "scatter",
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: [[o.bo.best.s, o.bo.best.Q]],
          symbol: "path://M50 5 L61 38 L95 38 L67 58 L78 92 L50 72 L22 92 L33 58 L5 38 L39 38 Z",
          symbolSize: 26,
          itemStyle: { color: "#FBBF24", borderColor: "#0a0f1c", borderWidth: 1.5 },
          z: 6,
        },
      ],
    };
  }, [engine, mode]);
  return <EChart option={option} height={420} ariaLabel="Heatmap of annual cost over reorder point and order quantity with infeasible cells hatched and Bayesian optimisation samples numbered" />;
}

export function TornadoChart({ engine }: { engine: EngineResult }) {
  const option = useMemo<ChartOption>(() => {
    const t = engine.tornado;
    const base = t.baseRopOpt;
    const bars = [...t.bars].sort((a, b) => Math.abs(a.ropOptHigh - a.ropOptLow) - Math.abs(b.ropOptHigh - b.ropOptLow));
    const labels = bars.map((b) => b.label);
    return {
      textStyle,
      tooltip: { ...tooltip, trigger: "axis", axisPointer: { type: "shadow" } },
      legend,
      grid: grid({ left: 190, top: 48, bottom: 52 }),
      xAxis: { type: "value", ...axis(`Change in reorder point vs base (units; cost-optimal base ${fmt(base)})`, { nameGap: 30 }) },
      yAxis: { type: "category", data: labels, ...axis(""), axisLabel: { color: "#CBD5E1", fontSize: 11 } },
      series: [
        { name: "Input -20% (cost-optimal ROP)", type: "bar", stack: "t", data: bars.map((b) => b.ropOptLow - base), itemStyle: { color: "rgba(56,189,248,0.75)" }, barWidth: "52%" },
        { name: "Input +20% (cost-optimal ROP)", type: "bar", stack: "t", data: bars.map((b) => b.ropOptHigh - base), itemStyle: { color: "rgba(45,212,191,0.85)" } },
        { name: "Slide formula ROP, -20%", type: "scatter", data: bars.map((b) => b.ropFormulaLow - t.baseRopFormula), symbol: "rect", symbolSize: [3, 16], itemStyle: { color: C.baseline } },
        { name: "Slide formula ROP, +20%", type: "scatter", data: bars.map((b) => b.ropFormulaHigh - t.baseRopFormula), symbol: "rect", symbolSize: [3, 16], itemStyle: { color: C.risk } },
      ],
    };
  }, [engine]);
  return <EChart option={option} height={330} ariaLabel="Tornado chart of how much the reorder point changes when each input moves 20 percent down or up" />;
}

export function SweepCharts({ engine }: { engine: EngineResult }) {
  const s = engine.sweeps;
  const mk = (title: string, xName: string, x: number[], y: number[], color: string): ChartOption => ({
    textStyle,
    tooltip,
    grid: grid({ left: 56, right: 12, top: 34, bottom: 48 }),
    legend: { show: false },
    xAxis: { type: "category", data: x.map((v) => fmt(v)), ...axis(xName, { nameGap: 28 }) },
    yAxis: { type: "value", ...axis("ROP (units)", { nameGap: 42 }), scale: true },
    series: [{ name: title, type: "line", data: y, itemStyle: { color }, lineStyle: { color, width: 2 }, symbolSize: 6 }],
  });
  const items = [
    { title: "Sensitivity to lead time", opt: mk("ROP vs lead time", "Lead time (weeks)", s.leadTime.x, s.leadTime.rop, C.baseline) },
    { title: "Sensitivity to weekly demand", opt: mk("ROP vs demand", "Weekly demand (units)", s.demand.x, s.demand.rop, C.ok) },
    { title: "Sensitivity to safety stock", opt: mk("ROP vs safety stock", "Safety stock (units)", s.safetyStock.x, s.safetyStock.rop, C.risk) },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      {items.map((it) => (
        <div key={it.title} className="rounded-xl border border-white/[0.06] bg-ink-950/30 p-2">
          <h3 className="px-2 pt-1 text-xs font-semibold text-slate-300">{it.title}</h3>
          <EChart option={it.opt} height={210} ariaLabel={`${it.title}: line chart of reorder point with a fixed 200-unit safety stock`} />
        </div>
      ))}
    </div>
  );
}
