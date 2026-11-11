/** Safety stock and risk charts: Monte Carlo LTD, safety stock vs service level, inventory trace. */
import { useMemo } from "react";
import type { EngineResult, PolicyResult } from "../../lib/engine/inventoryEngine";
import { fmt } from "../../lib/format";
import { EChart, type ChartOption } from "./EChart";
import { axis, C, grid, legend, textStyle, tooltip } from "./theme";

export function LtdHistogram({ engine, serviceLevel }: { engine: EngineResult; serviceLevel: number }) {
  const option = useMemo<ChartOption>(() => {
    const m = engine.mc;
    const bins = m.histogram;
    const width = bins[0].x1 - bins[0].x0;
    const labels = bins.map((b) => fmt((b.x0 + b.x1) / 2));
    const binOf = (x: number) => Math.min(bins.length - 1, Math.max(0, Math.floor((x - bins[0].x0) / width)));
    const data = bins.map((b) => ({
      value: (b.count / m.draws) * 100,
      itemStyle: { color: b.x0 >= m.ropMC ? C.risk : b.x1 > m.ropMC ? "rgba(244,63,94,0.55)" : "rgba(167,139,250,0.55)" },
    }));
    return {
      textStyle,
      tooltip: {
        ...tooltip,
        formatter: (p: unknown) => {
          const arr = p as { dataIndex: number; value: number }[];
          const b = bins[arr[0].dataIndex];
          return `${fmt(b.x0)} to ${fmt(b.x1)} units<br/>${fmt(arr[0].value, 2)}% of cycles`;
        },
      },
      grid: grid(),
      xAxis: { type: "category", data: labels, ...axis("Demand during lead time (units)", { nameGap: 30 }), axisLabel: { color: C.text, fontSize: 10, interval: 9 } },
      yAxis: { type: "value", ...axis("Share of simulated cycles (%)", { nameGap: 44 }) },
      series: [
        {
          name: "Lead-time demand",
          type: "bar",
          data,
          barCategoryGap: "8%",
          markLine: {
            symbol: "none",
            silent: true,
            label: { color: "#E2E8F0", fontSize: 10, formatter: "{b}" },
            data: [
              { name: `ROP Monte Carlo ${fmt(m.ropMC)} (${(serviceLevel * 100).toFixed(1)}%)`, xAxis: binOf(m.ropMC), lineStyle: { color: C.risk, width: 2 } },
              { name: `ROP formula ${fmt(m.ropFormula)}`, xAxis: binOf(m.ropFormula), lineStyle: { color: C.ai, type: "dashed" }, label: { position: "insideEndTop" } },
              { name: `Mean ${fmt(m.ltdMean)}`, xAxis: binOf(m.ltdMean), lineStyle: { color: "rgba(226,232,240,0.4)", type: "dotted" }, label: { position: "insideStartTop" } },
            ],
          },
        },
      ],
    };
  }, [engine, serviceLevel]);
  return <EChart option={option} height={320} ariaLabel="Histogram of simulated demand during lead time with the reorder points marked and the stockout tail shaded" />;
}

export function LeadTimeHistogram({ engine }: { engine: EngineResult }) {
  const option = useMemo<ChartOption>(() => {
    const m = engine.mc;
    const bins = m.leadTimeHistogram;
    return {
      textStyle,
      tooltip: { ...tooltip, valueFormatter: (v: unknown) => `${fmt(Number(v), 2)}%` },
      grid: grid({ left: 52, top: 16, bottom: 44 }),
      xAxis: { type: "category", data: bins.map((b) => fmt((b.x0 + b.x1) / 2, 1)), ...axis("Lead time (weeks)", { nameGap: 28 }), axisLabel: { color: C.text, fontSize: 10, interval: 7 } },
      yAxis: { type: "value", ...axis("Share (%)", { nameGap: 34 }) },
      series: [{ name: "Gamma lead time", type: "bar", data: bins.map((b) => (b.count / m.draws) * 100), itemStyle: { color: "rgba(56,189,248,0.6)" }, barCategoryGap: "6%" }],
    };
  }, [engine]);
  return <EChart option={option} height={190} ariaLabel="Histogram of simulated lead times drawn from a gamma distribution" />;
}

export function ServiceCurveChart({ engine, serviceLevel }: { engine: EngineResult; serviceLevel: number }) {
  const option = useMemo<ChartOption>(() => {
    const c = engine.curve;
    const x = c.map((p) => `${Math.round(p.serviceLevel * 100)}%`);
    const cur = Math.round(Math.min(0.99, Math.max(0.8, serviceLevel)) * 100) - 80;
    return {
      textStyle,
      tooltip,
      legend,
      grid: grid({ right: 70, top: 56 }),
      xAxis: { type: "category", data: x, ...axis("Target cycle service level", { nameGap: 30 }), boundaryGap: false },
      yAxis: [
        { type: "value", ...axis("Safety stock (units)", { nameGap: 46 }) },
        { type: "value", ...axis("Holding cost of buffer ($/week)", { nameGap: 52 }), splitLine: { show: false } },
      ],
      series: [
        {
          name: "Baseline: Z x sigma x sqrt(L)",
          type: "line",
          data: c.map((p) => p.ssBaseline),
          itemStyle: { color: C.baseline },
          lineStyle: { color: C.baseline, width: 2 },
          symbolSize: 5,
          markLine: { symbol: "none", silent: true, lineStyle: { color: "rgba(226,232,240,0.35)", type: "dashed" }, label: { color: C.text, fontSize: 10, formatter: "Current target" }, data: [{ xAxis: Math.max(0, cur) }] },
        },
        { name: "Slide formula (forecast error + lead-time risk)", type: "line", data: c.map((p) => p.ssFormula), itemStyle: { color: C.ai }, lineStyle: { color: C.ai, width: 2 }, symbolSize: 5 },
        { name: "Monte Carlo", type: "line", data: c.map((p) => p.ssMonteCarlo), itemStyle: { color: C.mc }, lineStyle: { color: C.mc, width: 2 }, symbolSize: 5 },
        { name: "Holding cost: slide formula", type: "line", yAxisIndex: 1, data: c.map((p) => p.holdFormula), symbol: "none", lineStyle: { color: C.ai, type: "dotted", width: 1.2 }, itemStyle: { color: C.ai } },
        { name: "Holding cost: baseline", type: "line", yAxisIndex: 1, data: c.map((p) => p.holdBaseline), symbol: "none", lineStyle: { color: C.baseline, type: "dotted", width: 1.2 }, itemStyle: { color: C.baseline } },
      ],
    };
  }, [engine, serviceLevel]);
  return <EChart option={option} height={340} ariaLabel="Line chart of safety stock and its holding cost against service level for the baseline, slide formula and Monte Carlo methods" />;
}

export function InventoryTraceChart({ policy }: { policy: PolicyResult }) {
  const option = useMemo<ChartOption>(() => {
    const t = policy.trace;
    const weeks = t.map((w) => w.week);
    return {
      textStyle,
      tooltip,
      legend,
      grid: grid({ top: 56 }),
      xAxis: { type: "category", data: weeks, ...axis("Simulated week", { nameGap: 30 }) },
      yAxis: { type: "value", ...axis("Units", { nameGap: 50 }) },
      series: [
        {
          name: "On hand (negative = backorders)",
          type: "line",
          data: t.map((w) => w.onHand),
          symbol: "none",
          lineStyle: { color: C.forecast, width: 2 },
          itemStyle: { color: C.forecast },
          areaStyle: { color: "rgba(56,189,248,0.08)" },
          markLine: { symbol: "none", silent: true, lineStyle: { color: "rgba(244,63,94,0.5)" }, label: { show: false }, data: [{ yAxis: 0 }] },
        },
        { name: "Inventory position", type: "line", data: t.map((w) => w.inventoryPosition), symbol: "none", lineStyle: { color: C.mc, width: 1.4, type: "dashed" }, itemStyle: { color: C.mc } },
        { name: "Reorder point", type: "line", step: "middle", data: t.map((w) => w.reorderPoint), symbol: "none", lineStyle: { color: C.risk, width: 1.6 }, itemStyle: { color: C.risk } },
        {
          name: "Order placed",
          type: "scatter",
          data: t.map((w) => (w.ordered > 0 ? w.inventoryPosition : null)),
          symbol: "triangle",
          symbolSize: 10,
          itemStyle: { color: C.baseline },
          tooltip: { valueFormatter: (v: unknown) => (v === null ? "-" : fmt(Number(v))) },
        },
        { name: "Delivery arrives", type: "scatter", data: t.map((w) => (w.arrived > 0 ? w.onHand : null)), symbol: "diamond", symbolSize: 10, itemStyle: { color: C.ai } },
      ],
    };
  }, [policy]);
  return <EChart option={option} height={340} ariaLabel="Line chart of simulated on-hand stock and inventory position against the reorder point, with order placements and deliveries marked" />;
}
