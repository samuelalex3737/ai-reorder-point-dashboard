/** Bullwhip Lab: the Session II lab activity, in the slide's four steps. */
import { Quote, RotateCcw, Zap } from "lucide-react";
import type { ReactNode } from "react";
import { BullwhipRatioChart, NetworkDiagram, OrdersByStageChart, StageCostChart } from "../components/charts/bullwhipCharts";
import { NumberField, Segmented, Slider, Toggle } from "../components/ui/Controls";
import { Kpi } from "../components/ui/Kpi";
import { Explainer, Panel } from "../components/ui/Panel";
import { RUN_KEYS, RUNS, type LabResult, type RunKey } from "../lib/bullwhip/lab";
import type { OrderRule, StageKey } from "../lib/bullwhip/simulate";
import { fmt, money, pct } from "../lib/format";
import { aiForecastStory, baseRunStory, bullwhipHeadline, routingStory } from "../lib/narrative";
import { useStore } from "../state/store";
import { Loading } from "./Loading";

const STAGES: { key: StageKey; label: string; lead: string }[] = [
  { key: "retailer", label: "Retailers (x3)", lead: "Distributor to retailer transit" },
  { key: "distributor", label: "Distributors (x2)", lead: "Manufacturer to distributor transit" },
  { key: "manufacturer", label: "Manufacturer", lead: "Production time" },
];

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-ai/40 bg-ai/10 text-sm font-bold text-ai">{n}</span>
        <h2 className="text-[17px] font-semibold text-slate-100">{title}</h2>
      </div>
      {children}
    </section>
  );
}

export function BullwhipLab() {
  const s = useStore();
  const bw = s.bwResult;
  const cfg = s.bwConfig;
  const labels = s.bullwhipData?.retailers.map((r) => r.label) ?? [];
  const busy = s.bwBusy;
  if (!bw) return <Loading what="the three Bullwhip Lab simulations" />;
  const lab = bw.result;
  const a = lab.runs.baseline;
  const c = lab.runs.aiRouting;
  const reduction = (1 - c.stages.manufacturer.bullwhip / a.stages.manufacturer.bullwhip) * 100;
  const runOptions = RUN_KEYS.map((k) => ({ value: k, label: RUNS[k].short }));

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="glass p-5 xl:col-span-3">
          <h2 className="text-[17px] font-semibold text-slate-100">Bullwhip Lab: mini-simulation and AI redesign of the network</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-slate-300">
            Session II lab activity: simulate the bullwhip effect in a Customers, Retailer, Distributor and Manufacturer chain, then redesign it with two AI levers, forecasting and routing. All three runs below
            use the same {a.weeks} weeks of real customer demand for item_20 at three stores, and every random element is seeded.
          </p>
          <figure className="mt-4 rounded-xl border border-white/[0.08] bg-ink-950/50 p-4">
            <Quote className="mb-2 h-4 w-4 text-watch" aria-hidden />
            <blockquote className="text-[13.5px] italic leading-relaxed text-slate-200">
              The Bullwhip Effect describes how small fluctuations in customer demand can cause increasingly larger swings in demand forecasts and inventory levels as you move upstream in a supply chain, from
              retailer to distributor to manufacturer. This leads to inefficiencies like overstocking, understocking, and inflated costs.
            </blockquote>
            <figcaption className="mt-2 text-[11px] text-slate-500">Session II lab slide, AI in Operations</figcaption>
          </figure>
        </div>
        <div className="grid grid-cols-2 gap-3 xl:col-span-2">
          <Kpi label="Manufacturer ratio, baseline" value={a.stages.manufacturer.bullwhip} decimals={2} suffix="x" tone="baseline" sub="Order variance / demand variance" />
          <Kpi label="Manufacturer ratio, full AI" value={c.stages.manufacturer.bullwhip} decimals={2} suffix="x" tone="ai" sub={`${fmt(reduction, 0)}% less amplification`} />
          <Kpi label="Network cost, baseline" value={a.totalCost} prefix="$" tone="baseline" sub={`${a.weeks - a.warmup} scored weeks`} />
          <Kpi label="Network cost, full AI" value={c.totalCost} prefix="$" tone="ai" sub={`Saves ${money(a.totalCost - c.totalCost)}`} />
        </div>
      </div>
      <Explainer text={bullwhipHeadline(lab)} />

      <Step n={1} title="Define the simulation environment">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
          <Panel
            className="xl:col-span-3"
            title="Network and stage parameters"
            subtitle="Customers, 3 retailers, 2 distributors, 1 manufacturer; weekly periods"
            busy={busy}
            actions={
              <button className="btn min-h-[34px] text-xs" onClick={s.resetBw}>
                <RotateCcw className="h-3.5 w-3.5" /> Reset lab
              </button>
            }
            explain={`Retailers are three real stores selling item_20 (the same product as SKU A), chosen for different volumes so the network is unbalanced. Their weekly sales are the customer demand. Distributors and the manufacturer are modelled: each orders up to a target of forecast x (lead time + 1) plus z x sigma x sqrt(lead time + 1), unmet orders are backlogged, and the manufacturer has unlimited capacity with a ${fmt(cfg.manufacturer.leadTime)}-week production time. Legacy (fixed) routing sends Retailers 1 and 2 to Distributor 1 and Retailer 3 to Distributor 2.`}
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12.5px]">
                <thead className="text-[11px] uppercase tracking-wider text-slate-400">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-2 font-semibold">Stage</th>
                    <th className="py-2 pr-2 font-semibold">Lead time (wk)</th>
                    <th className="py-2 pr-2 font-semibold">Order rule</th>
                    <th className="py-2 pr-2 font-semibold">Start stock (wk)</th>
                    <th className="py-2 pr-2 font-semibold">Holding $/unit-wk</th>
                    <th className="py-2 font-semibold">Backlog $/unit-wk</th>
                  </tr>
                </thead>
                <tbody>
                  {STAGES.map((st) => {
                    const p = cfg[st.key];
                    return (
                      <tr key={st.key} className="border-b border-white/[0.05] align-middle">
                        <td className="py-2 pr-2 text-slate-200">
                          {st.label}
                          <div className="text-[10.5px] text-slate-500">{st.lead}</div>
                        </td>
                        <td className="w-[110px] py-2 pr-2">
                          <NumberField label="" value={p.leadTime} min={1} onChange={(v) => s.setBwStage(st.key, { leadTime: Math.max(1, Math.min(8, Math.round(v || 1))) })} />
                        </td>
                        <td className="py-2 pr-2">
                          <Segmented<OrderRule>
                            size="sm"
                            ariaLabel={`${st.label} order rule`}
                            value={p.rule}
                            onChange={(v) => s.setBwStage(st.key, { rule: v })}
                            options={[
                              { value: "out", label: "Order-up-to", title: "Order the full gap to the target each week" },
                              { value: "smooth", label: "Smoothed", title: "Order expected demand plus 40% of the remaining gap" },
                            ]}
                          />
                        </td>
                        <td className="w-[100px] py-2 pr-2">
                          <NumberField label="" value={p.startCover} step={0.5} onChange={(v) => s.setBwStage(st.key, { startCover: Math.max(0, Math.min(10, v || 0)) })} />
                        </td>
                        <td className="w-[100px] py-2 pr-2">
                          <NumberField label="" value={p.holding} step={0.1} onChange={(v) => s.setBwStage(st.key, { holding: Math.max(0, v || 0) })} />
                        </td>
                        <td className="w-[100px] py-2">
                          <NumberField label="" value={p.backlog} step={0.5} onChange={(v) => s.setBwStage(st.key, { backlog: Math.max(0, v || 0) })} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <h3 className="mb-2 mt-4 text-[13px] font-semibold text-slate-200">Shipping cost per unit, distributor to retailer lane ($)</h3>
            <div className="grid grid-cols-4 gap-2 text-[12px]">
              <span />
              {labels.map((l) => (
                <span key={l} className="label self-end">
                  {l}
                </span>
              ))}
              {cfg.laneCost.map((row, d) => (
                <div key={d} className="contents">
                  <span className="self-center text-slate-300">
                    Distributor {d + 1}
                    {cfg.assign.map((x, r) => (x === d ? `R${r + 1}` : "")).filter(Boolean).length ? (
                      <span className="block text-[10.5px] text-slate-500">legacy: {cfg.assign.map((x, r) => (x === d ? `R${r + 1}` : "")).filter(Boolean).join(", ")}</span>
                    ) : null}
                  </span>
                  {row.map((v, r) => (
                    <NumberField key={r} label="" value={v} step={0.1} onChange={(x) => s.setBwLane(d, r, Math.max(0, Number.isFinite(x) ? x : 0))} />
                  ))}
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="xl:col-span-2" title="Simulation controls" subtitle="Everything below re-runs all three simulations live" busy={busy}>
            <div className="space-y-4">
              <Slider label="Forecast window (moving average)" value={cfg.window} min={2} max={12} step={1} onChange={(v) => s.setBwConfig({ window: v })} format={(v) => `${v} wk`} hint="Used by nodes that forecast from the orders they receive." />
              <Slider label="Safety factor z" value={cfg.safetyZ} min={0} max={2.5} step={0.05} onChange={(v) => s.setBwConfig({ safetyZ: v })} format={(v) => fmt(v, 2)} />
              <Toggle checked={cfg.infoSharing} onChange={(v) => s.setBwConfig({ infoSharing: v })} label="Information sharing (upstream sees the customer-demand forecast)" />
              <div className="space-y-1.5">
                <span className="label">Demand shock</span>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={`btn ${s.bwShock.enabled ? "btn-primary" : ""}`} onClick={() => s.setBwShock({ enabled: !s.bwShock.enabled })} aria-pressed={s.bwShock.enabled}>
                    <Zap className="h-4 w-4" /> {s.bwShock.enabled ? "Shock on: remove" : "Apply demand shock"}
                  </button>
                </div>
                {s.bwShock.enabled && (
                  <div className="space-y-3 pt-1">
                    <Slider label="Shock size" value={s.bwShock.size} min={0.1} max={1} step={0.05} onChange={(v) => s.setBwShock({ size: v })} format={(v) => `+${Math.round(v * 100)}%`} />
                    <Slider label="Shock length" value={s.bwShock.length} min={1} max={12} step={1} onChange={(v) => s.setBwShock({ length: v })} format={(v) => `${v} wk`} />
                    <Slider label="Shock starts in week" value={s.bwShock.start} min={8} max={44} step={1} onChange={(v) => s.setBwShock({ start: v })} format={(v) => `${v + 1}`} />
                  </div>
                )}
              </div>
              <div className="rounded-xl bg-white/[0.03] p-3 text-[12px] text-slate-400">
                Retailer demand (scored weeks):{" "}
                {lab.retailers.map((r) => (
                  <span key={r.id} className="mr-2 inline-block">
                    {r.id} <span className="num text-slate-200">{fmt(r.meanDemand)}</span>/wk
                  </span>
                ))}
                <div className="mt-1">Computed in {fmt(bw.millis)} ms in a background worker.</div>
              </div>
            </div>
          </Panel>
        </div>
      </Step>

      <Step n={2} title="Base simulation (no AI)">
        <Panel title="Orders by stage over time: baseline" subtitle="Moving-average forecasts at every node, order-up-to policy, fixed routing, first-come-first-served rationing" busy={busy} explain={baseRunStory(lab)}>
          <OrdersByStageChart lab={lab} run="baseline" />
        </Panel>
      </Step>

      <Step n={3} title="Integrate AI for forecasting">
        <Panel
          title="Orders by stage over time: AI forecasting"
          subtitle={`Retailers use the best ML forecast (out of sample); information sharing is ${cfg.infoSharing ? "on" : "off"}`}
          busy={busy}
          explain={aiForecastStory(lab, cfg.infoSharing)}
        >
          <OrdersByStageChart lab={lab} run="aiForecast" />
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wider text-slate-400">
                <tr className="border-b border-white/10">
                  <th className="py-1.5 pr-2 font-semibold">Retailer</th>
                  <th className="py-1.5 pr-2 font-semibold">Best model</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">WAPE %</th>
                  <th className="py-1.5 text-right font-semibold">Forecast error sd (units/wk)</th>
                </tr>
              </thead>
              <tbody>
                {lab.retailers.map((r) => (
                  <tr key={r.id} className="border-b border-white/[0.05]">
                    <td className="py-1.5 pr-2">{r.label}</td>
                    <td className="py-1.5 pr-2">{r.bestModel}</td>
                    <td className="num py-1.5 pr-2 text-right">{fmt(r.wape, 2)}</td>
                    <td className="num py-1.5 text-right">{fmt(r.sigmaD, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </Step>

      <Step n={4} title="Integrate AI for routing and optimisation">
        <Panel
          title="Network flows by routing policy"
          subtitle="Fixed legacy routing vs the min-cost allocation (exact LP solved as a min-cost flow each week)"
          busy={busy}
          actions={<Segmented<RunKey> size="sm" ariaLabel="Run to show" value={s.bwView} onChange={s.setBwView} options={runOptions} />}
          explain={routingStory(lab, labels)}
        >
          <NetworkDiagram lab={lab} run={s.bwView} retailerLabels={labels.map((l) => l.split(" (")[0])} />
        </Panel>
      </Step>

      <section className="space-y-4">
        <h2 className="text-[17px] font-semibold text-slate-100">Comparison on the same demand</h2>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Panel
            title="Bullwhip ratio per stage"
            subtitle="Variance of the tier's orders / variance of customer demand; above 1 means amplification"
            busy={busy}
            explain={`Reading left to right shows amplification building upstream. In the baseline it grows from ${fmt(a.stages.retailer.bullwhip, 2)}x to ${fmt(a.stages.manufacturer.bullwhip, 2)}x. The grey diamonds are the starter notebook, which multiplied each tier by a fixed 1.2 (variance ratio 1.44, 2.07 and 2.99) rather than letting it emerge from behaviour; its "AI" version simply lowered the multiplier to 1.05.`}
          >
            <BullwhipRatioChart lab={lab} />
          </Panel>
          <Panel
            title="Total network cost by run"
            subtitle="Holding + backlog + distributor-to-retailer shipping over the scored weeks"
            busy={busy}
            explain={`Baseline ${money(a.totalCost)}, AI forecasting ${money(lab.runs.aiForecast.totalCost)}, AI forecasting plus routing ${money(c.totalCost)}. Most of the saving comes from smaller safety buffers upstream once tiers stop over-reacting${c.stages.distributor.shippingCost < lab.runs.aiForecast.stages.distributor.shippingCost ? ", and routing then trims shipping cost by sending each retailer's stock along its cheapest lane" : ""}.`}
          >
            <StageCostChart lab={lab} />
          </Panel>
        </div>
        <Panel title="Cost, service and inventory per stage" subtitle="Per run, over the scored weeks (warm-up excluded)" busy={busy} explain={stageTableStory(lab)}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-[12.5px]">
              <thead className="text-[11px] uppercase tracking-wider text-slate-400">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-2 font-semibold">Run</th>
                  <th className="py-2 pr-2 font-semibold">Stage</th>
                  <th className="py-2 pr-2 text-right font-semibold">Bullwhip ratio</th>
                  <th className="py-2 pr-2 text-right font-semibold">Fill rate</th>
                  <th className="py-2 pr-2 text-right font-semibold">Avg backlog</th>
                  <th className="py-2 pr-2 text-right font-semibold">Avg inventory</th>
                  <th className="py-2 text-right font-semibold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {RUN_KEYS.flatMap((k) =>
                  (["retailer", "distributor", "manufacturer"] as StageKey[]).map((st, i) => {
                    const m = lab.runs[k].stages[st];
                    return (
                      <tr key={`${k}${st}`} className={`border-b border-white/[0.05] ${i === 2 ? "border-b-white/15" : ""}`}>
                        <td className="py-1.5 pr-2 text-slate-300">{i === 0 ? RUNS[k].name : ""}</td>
                        <td className="py-1.5 pr-2 capitalize">{st}</td>
                        <td className="num py-1.5 pr-2 text-right">{fmt(m.bullwhip, 2)}x</td>
                        <td className="num py-1.5 pr-2 text-right">{pct(m.fillRate, 1)}</td>
                        <td className="num py-1.5 pr-2 text-right">{fmt(m.avgBacklog)}</td>
                        <td className="num py-1.5 pr-2 text-right">{fmt(m.avgInventory)}</td>
                        <td className="num py-1.5 text-right">{money(m.totalCost)}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </section>
    </div>
  );
}

function stageTableStory(lab: LabResult): string {
  const a = lab.runs.baseline.stages;
  const c = lab.runs.aiRouting.stages;
  const invCut = 1 - (c.distributor.avgInventory + c.manufacturer.avgInventory) / (a.distributor.avgInventory + a.manufacturer.avgInventory);
  return `Upstream stock (distributors plus manufacturer) averages ${fmt(a.distributor.avgInventory + a.manufacturer.avgInventory)} units in the baseline and ${fmt(c.distributor.avgInventory + c.manufacturer.avgInventory)} with both AI levers, ${invCut >= 0 ? `${fmt(invCut * 100, 0)}% less` : `${fmt(-invCut * 100, 0)}% more`}. Retailer fill rate goes from ${pct(a.retailer.fillRate, 1)} to ${pct(c.retailer.fillRate, 1)}, and manufacturer fill rate from ${pct(a.manufacturer.fillRate, 1)} to ${pct(c.manufacturer.fillRate, 1)}: less amplification means less over-stocking and fewer shortfalls at the same time.`;
}
