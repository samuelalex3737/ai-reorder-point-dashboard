/** Bullwhip Lab charts: orders by stage, bullwhip ratios, cost by stage, and the network diagram. */
import { useMemo } from "react";
import type { LabResult, RunKey } from "../../lib/bullwhip/lab";
import { RUN_KEYS, RUNS } from "../../lib/bullwhip/lab";
import type { BullwhipResult } from "../../lib/bullwhip/simulate";
import { fmt } from "../../lib/format";
import { EChart, type ChartOption } from "./EChart";
import { axis, C, grid, legend, textStyle, tooltip } from "./theme";

const STAGE_COLORS = { customer: C.actual, retailer: C.forecast, distributor: C.mc, manufacturer: C.risk };
const RUN_COLORS: Record<RunKey, string> = { baseline: C.baseline, aiForecast: C.forecast, aiRouting: C.ai };

export function OrdersByStageChart({ lab, run }: { lab: LabResult; run: RunKey }) {
  const option = useMemo<ChartOption>(() => {
    const r = lab.runs[run];
    const line = (name: string, data: number[], color: string, width = 2) => ({ name, type: "line", data, symbol: "none", lineStyle: { color, width }, itemStyle: { color } });
    const area =
      lab.shockWeeks !== null
        ? { silent: true, itemStyle: { color: "rgba(244,63,94,0.08)" }, label: { color: C.text, fontSize: 10, position: "insideTop" }, data: [[{ name: "Demand shock", xAxis: lab.shockWeeks[0] }, { xAxis: lab.shockWeeks[1] }]] }
        : undefined;
    return {
      textStyle,
      tooltip,
      legend,
      grid: grid({ top: 56 }),
      xAxis: { type: "category", data: lab.weeks, ...axis("Week starting", { nameGap: 30 }) },
      yAxis: { type: "value", ...axis("Units per week (all nodes in the tier)", { nameGap: 52 }), scale: true },
      series: [
        {
          ...line("Customer demand", r.customerDemand, STAGE_COLORS.customer, 2.4),
          markArea: {
            silent: true,
            itemStyle: { color: "rgba(148,163,184,0.06)" },
            label: { color: C.text, fontSize: 10, position: "insideTopLeft" },
            data: [[{ name: "Warm-up (not scored)", xAxis: lab.weeks[0] }, { xAxis: lab.weeks[r.warmup - 1] }]],
          },
        },
        line("Retailer orders", r.stages.retailer.orders, STAGE_COLORS.retailer),
        line("Distributor orders", r.stages.distributor.orders, STAGE_COLORS.distributor),
        { ...line("Manufacturer production orders", r.stages.manufacturer.orders, STAGE_COLORS.manufacturer), markArea: area },
      ],
    };
  }, [lab, run]);
  return <EChart option={option} height={330} ariaLabel={`Line chart of weekly customer demand and the orders placed by each tier under ${RUNS[run].name}`} />;
}

export function BullwhipRatioChart({ lab }: { lab: LabResult }) {
  const option = useMemo<ChartOption>(() => {
    const stages = ["retailer", "distributor", "manufacturer"] as const;
    return {
      textStyle,
      tooltip: { ...tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => (typeof v === "number" ? `${fmt(v, 2)}x` : "-") },
      legend,
      grid: grid({ top: 56 }),
      xAxis: { type: "category", data: ["Retailers", "Distributors", "Manufacturer"], ...axis("Supply chain stage (moving upstream)", { nameGap: 30 }) },
      yAxis: { type: "value", ...axis("Order variance / customer demand variance", { nameGap: 44 }) },
      series: [
        ...RUN_KEYS.map((k) => ({
          name: RUNS[k].name,
          type: "bar",
          data: stages.map((s) => lab.runs[k].stages[s].bullwhip),
          itemStyle: { color: RUN_COLORS[k] },
          barGap: "10%",
          label: { show: true, position: "top", color: "#CBD5E1", fontSize: 10, formatter: (p: { value: number }) => fmt(p.value, 2) },
        })),
        {
          name: "Starter notebook (hard-coded x1.2 per tier)",
          type: "line",
          data: [1.2 ** 2, 1.2 ** 4, 1.2 ** 6],
          symbol: "diamond",
          symbolSize: 9,
          lineStyle: { color: C.muted, type: "dashed" },
          itemStyle: { color: C.muted },
        },
        {
          name: "No amplification (ratio 1)",
          type: "line",
          data: [1, 1, 1],
          symbol: "none",
          lineStyle: { color: "rgba(226,232,240,0.35)", type: "dotted" },
          itemStyle: { color: "rgba(226,232,240,0.35)" },
        },
      ],
    };
  }, [lab]);
  return <EChart option={option} height={330} ariaLabel="Grouped bar chart of the bullwhip ratio at each stage for the three runs, with the starter notebook's hard-coded ratios for reference" />;
}

export function StageCostChart({ lab }: { lab: LabResult }) {
  const option = useMemo<ChartOption>(() => {
    const parts = [
      { key: "holdingCost", name: "Holding", color: "rgba(56,189,248,0.75)" },
      { key: "backlogCost", name: "Backlog", color: "rgba(244,63,94,0.8)" },
      { key: "shippingCost", name: "Shipping (distributor to retailer)", color: "rgba(167,139,250,0.75)" },
    ] as const;
    const total = (r: BullwhipResult, k: (typeof parts)[number]["key"]) => r.stages.retailer[k] + r.stages.distributor[k] + r.stages.manufacturer[k];
    return {
      textStyle,
      tooltip: { ...tooltip, axisPointer: { type: "shadow" }, valueFormatter: (v: unknown) => `$${fmt(Number(v))}` },
      legend,
      grid: grid({ top: 56, left: 72 }),
      xAxis: { type: "category", data: RUN_KEYS.map((k) => RUNS[k].short), ...axis("") },
      yAxis: { type: "value", ...axis("Network cost over the scored weeks ($)", { nameGap: 58 }), axisLabel: { color: C.text, fontSize: 10, formatter: (v: number) => `$${fmt(v / 1000)}k` } },
      series: parts.map((p) => ({ name: p.name, type: "bar", stack: "c", barWidth: "45%", data: RUN_KEYS.map((k) => total(lab.runs[k], p.key)), itemStyle: { color: p.color } })),
    };
  }, [lab]);
  return <EChart option={option} height={300} ariaLabel="Stacked bar chart of holding, backlog and shipping cost for each run" />;
}

/** Network diagram: lanes coloured and sized by shipped volume under a run's routing. */
export function NetworkDiagram({ lab, run, retailerLabels }: { lab: LabResult; run: RunKey; retailerLabels: string[] }) {
  const r = lab.runs[run];
  const scored = r.weeks - r.warmup;
  const maxLane = Math.max(1, ...r.laneVolume.flat(), ...r.mfgVolume);
  const W = 720;
  const H = 300;
  const M = { x: 70, y: H / 2 };
  const Ds = [
    { x: 290, y: 90 },
    { x: 290, y: 210 },
  ];
  const Rs = [
    { x: 520, y: 55 },
    { x: 520, y: 150 },
    { x: 520, y: 245 },
  ];
  const Cx = 670;
  const lane = (x1: number, y1: number, x2: number, y2: number, vol: number, key: string, labelPos = 0.5) => {
    const w = vol > 0 ? 1.5 + 10 * (vol / maxLane) : 1;
    const active = vol > 0.5;
    const lx = x1 + (x2 - x1) * labelPos;
    const ly = y1 + (y2 - y1) * labelPos;
    return (
      <g key={key}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={active ? C.ai : "rgba(148,163,184,0.35)"} strokeOpacity={active ? 0.35 + 0.6 * (vol / maxLane) : 1} strokeWidth={w} strokeDasharray={active ? undefined : "4 5"} strokeLinecap="round" />
        {active && (
          <text x={lx} y={ly - 6} fill="#E2E8F0" fontSize="11" textAnchor="middle" className="num">
            {fmt(vol / scored)}/wk
          </text>
        )}
      </g>
    );
  };
  const node = (x: number, y: number, title: string, sub: string, color: string, key: string) => (
    <g key={key}>
      <rect x={x - 56} y={y - 22} width={112} height={44} rx={10} fill="rgba(14,20,36,0.95)" stroke={color} strokeOpacity={0.7} />
      <text x={x} y={y - 3} fill="#F1F5F9" fontSize="12" fontWeight="600" textAnchor="middle">
        {title}
      </text>
      <text x={x} y={y + 13} fill="#94A3B8" fontSize="10" textAnchor="middle">
        {sub}
      </text>
    </g>
  );
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[620px]" role="img" aria-label={`Network diagram of shipped volume per lane under ${RUNS[run].name}`}>
        {Ds.map((d, i) => lane(M.x + 56, M.y, d.x - 56, d.y, r.mfgVolume[i], `m${i}`))}
        {Ds.flatMap((d, i) => Rs.map((rr, j) => lane(d.x + 56, d.y, rr.x - 56, rr.y, r.laneVolume[i][j], `d${i}r${j}`, i === 0 ? 0.32 : 0.68)))}
        {Rs.map((rr, j) => (
          <line key={`c${j}`} x1={rr.x + 56} y1={rr.y} x2={Cx - 20} y2={rr.y} stroke="rgba(226,232,240,0.25)" strokeWidth={2} />
        ))}
        {node(M.x, M.y, "Manufacturer", `ratio ${fmt(r.stages.manufacturer.bullwhip, 2)}x`, C.risk, "M")}
        {Ds.map((d, i) => node(d.x, d.y, `Distributor ${i + 1}`, `ratio ${fmt(r.nodeOrders[3 + i].bullwhip, 2)}x`, C.mc, `D${i}`))}
        {Rs.map((rr, j) => node(rr.x, rr.y, retailerLabels[j], `ratio ${fmt(r.nodeOrders[j].bullwhip, 2)}x`, C.forecast, `R${j}`))}
        {Rs.map((rr, j) => (
          <g key={`cust${j}`}>
            <circle cx={Cx} cy={rr.y} r={14} fill="rgba(226,232,240,0.08)" stroke="rgba(226,232,240,0.4)" />
            <text x={Cx} y={rr.y + 4} fill="#CBD5E1" fontSize="10" textAnchor="middle">
              C
            </text>
          </g>
        ))}
      </svg>
      <p className="mt-1 text-[11px] text-slate-500">Lane width and colour scale with units shipped per week over the scored weeks; dashed lanes carried nothing. C = customers.</p>
    </div>
  );
}
