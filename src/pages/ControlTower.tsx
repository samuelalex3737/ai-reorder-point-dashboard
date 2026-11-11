import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Eye, PackagePlus } from "lucide-react";
import { useEffect, useMemo } from "react";
import { DynamicRopChart, PolicyCostChart } from "../components/charts/decisionCharts";
import { NumberField } from "../components/ui/Controls";
import { Kpi } from "../components/ui/Kpi";
import { Explainer, Panel } from "../components/ui/Panel";
import { SCENARIOS } from "../lib/engine/params";
import { MODEL_INFO } from "../lib/forecast/pipeline";
import { fmt, money, pct } from "../lib/format";
import { decide } from "../lib/inventory/decision";
import { comparisonStory, decisionStory, dynamicRopStory, scenarioStory } from "../lib/narrative";
import { useEngine, useForecast, useSku } from "../state/hooks";
import { useStore } from "../state/store";
import { Loading } from "./Loading";

export function ControlTower() {
  const { entry: fc } = useForecast();
  const { entry: en, stale } = useEngine();
  const { series, state } = useSku();
  const setDecision = useStore((s) => s.setDecision);
  const scenarioKey = useStore((s) => s.scenarioKey);
  const controls = state.controls;

  // Sensible starting position: stock a little above this week's reorder point.
  useEffect(() => {
    if (en && !state.decision) {
      const rop = en.result.dynamicRop[0].rop;
      setDecision({ onHand: Math.round(rop + 0.6 * en.result.demandPath[0]), onOrder: 0, backorders: 0 });
    }
  }, [en, state.decision, setDecision]);

  const decision = useMemo(() => {
    if (!en || !fc || !state.decision) return null;
    const e = en.result;
    const bayes = e.policies.find((p) => p.key === "bayes")!;
    return decide({
      ...state.decision,
      onHand: Number.isFinite(state.decision.onHand) ? state.decision.onHand : 0,
      onOrder: Number.isFinite(state.decision.onOrder) ? state.decision.onOrder : 0,
      backorders: Number.isFinite(state.decision.backorders) ? state.decision.backorders : 0,
      rop: e.dynamicRop[0].rop,
      Q: bayes.Q,
      weeklyForecast: e.demandPath,
      ltdSorted: e.mc.ltd,
    });
  }, [en, fc, state.decision]);

  if (!fc || !en) return <Loading what="the forecast and optimisation" />;
  const e = en.result;
  const f = fc.result;
  const best = f.models.find((m) => m.key === f.bestKey)!;
  const base = e.policies.find((p) => p.key === "static")!;
  const feasibleAi = e.policies.filter((p) => p.kind === "ai" && p.targetMet && p.capacityOk);
  const bestAi = (feasibleAi.length ? feasibleAi : e.policies.filter((p) => p.kind === "ai")).reduce((a, b) => (b.sim.annualCost < a.sim.annualCost ? b : a));
  const bayes = e.policies.find((p) => p.key === "bayes")!;
  const d = state.decision ?? { onHand: 0, onOrder: 0, backorders: 0 };

  const statusUi = {
    order: { icon: <PackagePlus className="h-6 w-6" />, title: `Order now: ${fmt(decision?.orderQty ?? 0)} units`, cls: "border-risk/40 bg-risk/10 text-rose-200" },
    watch: { icon: <Eye className="h-6 w-6" />, title: "Watch: order likely next week", cls: "border-watch/40 bg-watch/10 text-amber-200" },
    healthy: { icon: <CheckCircle2 className="h-6 w-6" />, title: "Healthy: no order needed", cls: "border-ok/40 bg-ok/10 text-emerald-200" },
  } as const;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Reorder point this week" value={e.dynamicRop[0].rop} tone="ai" sub={`Baseline ${fmt(e.ss.ropStatic)} units`} />
        <Kpi label="Safety stock (slide formula)" value={e.ss.formula} tone="ai" sub={`Baseline ${fmt(e.ss.static)} units`} />
        <Kpi label="Forecast error sigma_D" value={e.effective.sigmaD} decimals={1} tone="forecast" sub={`Raw demand sd ${fmt(e.effective.sigmaRaw)} /wk`} />
        <Kpi label="Best forecast model" value={best.metrics.wape} decimals={2} suffix="% WAPE" tone="forecast" sub={MODEL_INFO[best.key].name} />
        <Kpi label="Stockout risk (lead time)" value={(decision?.stockoutProb ?? 0) * 100} decimals={1} suffix="%" tone={decision && decision.stockoutProb > 0.05 ? "risk" : "neutral"} sub={`At inventory position ${fmt(decision?.inventoryPosition)}`} />
        <Kpi label="Annual cost, best AI policy" value={bestAi.sim.annualCost} prefix="$" tone="ai" sub={`Baseline ${money(base.sim.annualCost)}${base.targetMet ? "" : " (misses target)"}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-2"
          title="Replenishment decision"
          subtitle={`${series.label} - enter today's stock to get a recommendation`}
          busy={stale}
          explain={decision ? decisionStory(decision, e.dynamicRop[0].rop, bayes.Q, e.effective.L) : undefined}
        >
          <div className="grid grid-cols-3 gap-2">
            <NumberField label="On hand" value={d.onHand} onChange={(v) => setDecision({ ...d, onHand: v })} suffix="units" />
            <NumberField label="On order" value={d.onOrder} onChange={(v) => setDecision({ ...d, onOrder: v })} suffix="units" />
            <NumberField label="Backorders" value={d.backorders} onChange={(v) => setDecision({ ...d, backorders: v })} suffix="units" />
          </div>
          <AnimatePresence mode="wait">
            {decision && (
              <motion.div
                key={decision.status}
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ duration: 0.25 }}
                className={`mt-4 flex items-center gap-3 rounded-xl border p-4 ${statusUi[decision.status].cls}`}
                role="status"
              >
                {statusUi[decision.status].icon}
                <div>
                  <div className="text-lg font-semibold">{statusUi[decision.status].title}</div>
                  <div className="text-xs opacity-80">
                    Inventory position {fmt(decision.inventoryPosition)} vs reorder point {fmt(e.dynamicRop[0].rop)}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {decision && (
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.03] p-2.5">
                <dt className="label">Stockout risk</dt>
                <dd className="num mt-1 text-lg text-slate-100">{pct(decision.stockoutProb, 1)}</dd>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-2.5">
                <dt className="label">If you wait 1 wk</dt>
                <dd className="num mt-1 text-lg text-slate-100">{pct(decision.stockoutProbIfWait, 1)}</dd>
              </div>
              <div className="rounded-xl bg-white/[0.03] p-2.5">
                <dt className="label">Weeks of cover</dt>
                <dd className="num mt-1 text-lg text-slate-100">{fmt(decision.weeksOfCover, 1)}</dd>
              </div>
            </dl>
          )}
          {scenarioKey !== "normal" && (
            <p className="mt-3 flex items-start gap-2 text-xs text-rose-200/90">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {scenarioStory(SCENARIOS[scenarioKey], e)}
            </p>
          )}
        </Panel>

        <Panel
          className="xl:col-span-3"
          title="Dynamic reorder point over the next 26 weeks vs the flat baseline"
          subtitle="Adaptive decision-making: the AI reorder point follows the forecast for each week's lead-time window"
          busy={stale}
          explain={dynamicRopStory(e, 26)}
        >
          <DynamicRopChart engine={e} forecast={f.forecast} weeks={26} />
        </Panel>
      </div>

      <Panel
        title="Baseline vs AI-enhanced: every policy on the same simulator"
        subtitle={`200 simulated years with identical demand and lead-time draws; fill-rate target ${pct(controls.targetFillRate, 1)}, capacity ${fmt(controls.capacity)} units`}
        busy={stale}
        explain={comparisonStory(e, controls.targetFillRate)}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wider text-slate-400">
              <tr className="border-b border-white/10">
                <th className="py-2 pr-3 font-semibold">Policy</th>
                <th className="py-2 pr-3 text-right font-semibold">ROP s</th>
                <th className="py-2 pr-3 text-right font-semibold">Order Q</th>
                <th className="py-2 pr-3 text-right font-semibold">Annual cost</th>
                <th className="py-2 pr-3 text-right font-semibold">Holding / Stockout / Ordering</th>
                <th className="py-2 pr-3 text-right font-semibold">Fill rate</th>
                <th className="py-2 pr-3 text-right font-semibold">Cycle SL</th>
                <th className="py-2 pr-3 text-right font-semibold">P(stockout week)</th>
                <th className="py-2 pr-3 text-right font-semibold">Avg on hand</th>
                <th className="py-2 font-semibold">Target met</th>
              </tr>
            </thead>
            <tbody>
              {e.policies.map((p) => (
                <tr key={p.key} className={`border-b border-white/[0.05] ${p.key === bestAi.key ? "bg-ai/[0.06]" : ""}`}>
                  <td className="py-2 pr-3">
                    <span className={`mr-2 inline-block h-2 w-2 rounded-full ${p.kind === "ai" ? "bg-ai" : "bg-baseline"}`} />
                    {p.name}
                  </td>
                  <td className="num py-2 pr-3 text-right">{p.key === "dynamic" ? `${fmt(e.dynamicRop[0].rop)} to ${fmt(p.sMax)}` : fmt(p.s)}</td>
                  <td className="num py-2 pr-3 text-right">{fmt(p.Q)}</td>
                  <td className="num py-2 pr-3 text-right font-semibold">{money(p.sim.annualCost)}</td>
                  <td className="num py-2 pr-3 text-right text-slate-400">
                    {money(p.sim.holding)} / {money(p.sim.shortage)} / {money(p.sim.ordering)}
                  </td>
                  <td className="num py-2 pr-3 text-right">{pct(p.sim.fillRate, 1)}</td>
                  <td className="num py-2 pr-3 text-right">{pct(p.sim.cycleServiceLevel, 1)}</td>
                  <td className="num py-2 pr-3 text-right">{pct(p.sim.weeklyStockoutProb, 1)}</td>
                  <td className="num py-2 pr-3 text-right">{fmt(p.sim.avgOnHand)}</td>
                  <td className="py-2">
                    {p.targetMet ? <span className="text-ok">Yes</span> : <span className="text-risk">No</span>}
                    {!p.capacityOk && <span className="ml-1 text-xs text-watch">(over capacity)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-4">
          <h3 className="mb-1 text-[13px] font-semibold text-slate-200">Annual cost breakdown and fill rate by policy</h3>
          <PolicyCostChart engine={e} targetFill={controls.targetFillRate} />
          <Explainer
            text={`Bars split each policy's yearly cost into holding (stock sitting on the shelf), stockouts (unmet demand at ${money(controls.stockoutCost)} a unit) and ordering (${money(controls.orderCost)} per order). Dots show the fill rate against the ${pct(controls.targetFillRate, 1)} target line. The highlighted row, "${bestAi.name}", is the cheapest AI policy that meets every constraint, saving ${money(base.sim.annualCost - bestAi.sim.annualCost)} a year against the static baseline.`}
          />
        </div>
      </Panel>
    </div>
  );
}
