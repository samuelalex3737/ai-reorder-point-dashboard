import { useState } from "react";
import { InventoryTraceChart, LeadTimeHistogram, LtdHistogram, ServiceCurveChart } from "../components/charts/riskCharts";
import { Segmented } from "../components/ui/Controls";
import { Kpi } from "../components/ui/Kpi";
import { Panel } from "../components/ui/Panel";
import type { PolicyKey } from "../lib/engine/inventoryEngine";
import { fmt, pct } from "../lib/format";
import { cslStory, mcStory, ssStory, traceStory } from "../lib/narrative";
import { useEngine, useSku } from "../state/hooks";
import { Loading } from "./Loading";

export function Risk() {
  const { entry, stale } = useEngine();
  const { state } = useSku();
  const [policy, setPolicy] = useState<PolicyKey>("bayes");
  if (!entry) return <Loading what="the Monte Carlo simulation" />;
  const e = entry.result;
  const c = state.controls;
  const eff = e.effective;
  const p = e.policies.find((x) => x.key === policy)!;
  const z = eff.z;

  return (
    <div className="space-y-4">
      <div className="glass p-4 sm:p-5">
        <h2 className="text-[15px] font-semibold text-slate-100">Dynamic safety stock: the slide formula with live inputs</h2>
        <div className="mt-3 overflow-x-auto">
          <div className="num min-w-[560px] rounded-xl bg-ink-950/50 p-3 text-[13px] leading-7 text-slate-200">
            SS = Z x sqrt(sigma_D^2 x L + Dbar^2 x sigma_L^2)
            <br />= {fmt(z, 4)} x sqrt({fmt(eff.sigmaD, 2)}^2 x {fmt(eff.L, 2)} + {fmt(eff.dBar, 1)}^2 x {fmt(eff.sigmaL, 2)}^2)
            <br />= {fmt(z, 4)} x sqrt({fmt(eff.sigmaD ** 2 * eff.L, 1)} + {fmt(eff.dBar ** 2 * eff.sigmaL ** 2, 1)}) = <span className="text-ai">{fmt(e.ss.formula, 1)} units</span>
            <br />
            ROP = Dbar x L + SS = {fmt(eff.dBar, 1)} x {fmt(eff.L, 2)} + {fmt(e.ss.formula, 1)} = <span className="text-ai">{fmt(e.ss.ropFormula, 1)} units</span>
          </div>
        </div>
        <p className="mt-3 text-[12.5px] leading-relaxed text-slate-400">
          Z for a {pct(c.serviceLevel, 1)} cycle service level; sigma_D = standard deviation of the best model's out-of-sample weekly forecast errors; Dbar = mean forecast over the next {Math.ceil(eff.L)} week(s) (the lead-time window); L and sigma_L in weeks. Demand noise contributes {pct(e.ss.shares.demand, 1)} of the variance under the square root, lead-time uncertainty {pct(e.ss.shares.leadTime, 1)}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="ROP, Monte Carlo" value={e.mc.ropMC} tone="mc" sub={`SS ${fmt(e.mc.ssMC)} units`} />
        <Kpi label="ROP, slide formula" value={e.ss.ropFormula} tone="ai" sub={`SS ${fmt(e.ss.formula)} units`} />
        <Kpi label="ROP, professor baseline" value={e.ss.ropStatic} tone="baseline" sub={`SS ${fmt(e.ss.static)} units`} />
        <Kpi label="Stockout risk at formula ROP" value={e.mc.stockoutProbAtFormula * 100} decimals={1} suffix="%" tone="risk" sub={`Target ${pct(1 - c.serviceLevel, 1)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title="Monte Carlo: demand during lead time"
          subtitle={`${fmt(e.mc.draws)} seeded draws; lead time ~ Gamma(mean ${fmt(eff.L, 1)}, sd ${fmt(eff.sigmaL, 1)} wk); demand | lead time ~ Normal(Dbar x lt, sigma_D x sqrt(lt))`}
          busy={stale}
          explain={mcStory(e, c.serviceLevel)}
        >
          <LtdHistogram engine={e} serviceLevel={c.serviceLevel} />
        </Panel>
        <Panel title="Simulated lead times" subtitle="Positive and right-skewed: late deliveries are more likely than early ones" busy={stale} explain={`The mean simulated lead time is ${fmt(e.mc.leadTimeMean, 2)} weeks with sd ${fmt(e.mc.leadTimeSd, 2)}, matching the inputs. One cycle in twenty waits longer than ${fmt(e.mc.leadTimeP95, 1)} weeks; those slow deliveries drive the right tail of the demand distribution and the buffer needed to cover it.`}>
          <LeadTimeHistogram engine={e} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title="Safety stock vs service level (80% to 99%)" subtitle="Baseline vs slide formula vs Monte Carlo, with the weekly cost of holding each buffer" busy={stale} explain={ssStory(e, c.serviceLevel)}>
          <ServiceCurveChart engine={e} serviceLevel={c.serviceLevel} />
        </Panel>
        <Panel title="Cycle service level vs fill rate" subtitle="Why the formula's Z and the simulator's fill rate are different numbers" busy={stale} explain={cslStory(e, c.serviceLevel, c.targetFillRate)}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[460px] text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-slate-400">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-3 font-semibold">Policy</th>
                  <th className="py-2 pr-3 text-right font-semibold">Target CSL</th>
                  <th className="py-2 pr-3 text-right font-semibold">Achieved CSL</th>
                  <th className="py-2 text-right font-semibold">Fill rate</th>
                </tr>
              </thead>
              <tbody>
                {e.policies.map((x) => (
                  <tr key={x.key} className="border-b border-white/[0.05]">
                    <td className="py-2 pr-3">{x.name}</td>
                    <td className="num py-2 pr-3 text-right text-slate-400">{x.key === "dynamic" || x.key === "monteCarlo" || x.key === "static" ? pct(c.serviceLevel, 1) : "-"}</td>
                    <td className="num py-2 pr-3 text-right">{pct(x.sim.cycleServiceLevel, 1)}</td>
                    <td className="num py-2 text-right">{pct(x.sim.fillRate, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <Panel
        title="Inventory simulation against the reorder point"
        subtitle="One of the 200 simulated years: on-hand stock, inventory position, order placements and deliveries"
        busy={stale}
        actions={
          <Segmented
            size="sm"
            ariaLabel="Policy to simulate"
            value={policy}
            onChange={setPolicy}
            options={[
              { value: "static", label: "Baseline" },
              { value: "dynamic", label: "AI dynamic" },
              { value: "monteCarlo", label: "AI Monte Carlo" },
              { value: "bayes", label: "AI optimised" },
            ]}
          />
        }
        explain={traceStory(p, e.simWeeks)}
      >
        <InventoryTraceChart policy={p} />
      </Panel>
    </div>
  );
}
