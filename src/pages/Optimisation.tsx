import { useState } from "react";
import { ConvergenceChart, CostHeatmap, SweepCharts, TornadoChart } from "../components/charts/optimCharts";
import { Segmented } from "../components/ui/Controls";
import { Kpi } from "../components/ui/Kpi";
import { Panel } from "../components/ui/Panel";
import { fmt, money, pct } from "../lib/format";
import { convergenceStory, heatmapStory, sweepStory, tornadoStory } from "../lib/narrative";
import { useEngine, useSku } from "../state/hooks";
import { Loading } from "./Loading";

export function Optimisation() {
  const { entry, stale } = useEngine();
  const { state } = useSku();
  const [mode, setMode] = useState<"simulated" | "surrogate">("simulated");
  if (!entry) return <Loading what="the Bayesian optimisation" />;
  const e = entry.result;
  const o = e.optimisation;
  const c = state.controls;
  const bayes = e.policies.find((p) => p.key === "bayes")!;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Optimal reorder point s*" value={o.bo.best.s} tone="ai" sub={`Formula ROP ${fmt(e.ss.ropFormula)}`} />
        <Kpi label="Optimal order quantity Q*" value={o.bo.best.Q} tone="ai" sub={`EOQ ${fmt(e.effective.eoq)}`} />
        <Kpi label="Annual cost at optimum" value={bayes.sim.annualCost} prefix="$" tone="ai" sub={`Fill rate ${pct(bayes.sim.fillRate, 1)}`} />
        <Kpi label="Evaluations used" value={o.bo.evaluations.length} tone="neutral" sub="Same budget as random search" />
        <Kpi label="Gap to 400-point grid" value={o.gapPct} decimals={2} suffix="%" tone={o.gapPct <= 0.5 ? "ai" : "baseline"} sub={`Grid best ${money(o.fullGridBest.objective)}`} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel
          title="Convergence: Bayesian optimisation vs random search vs manual grid"
          subtitle="Same simulator, same seed, same common random numbers; BO and random search both start from the formula and Monte Carlo policies"
          busy={stale}
          explain={convergenceStory(e)}
        >
          <ConvergenceChart engine={e} />
        </Panel>
        <Panel
          title="Sensitivity of the reorder point (+/-20% tornado)"
          subtitle="Each input moved 20% down and up, one at a time; the cost-optimal ROP is re-optimised on the simulator"
          busy={stale}
          explain={tornadoStory(e)}
        >
          <TornadoChart engine={e} />
        </Panel>
      </div>

      <Panel
        title="Cost landscape over (reorder point, order quantity)"
        subtitle={`20 x 20 simulated grid (${fmt(o.box.sMin)}-${fmt(o.box.sMax)} x ${fmt(o.box.qMin)}-${fmt(o.box.qMax)} units). Hatched: infeasible (fill rate below ${pct(c.targetFillRate, 1)}, over ${fmt(c.capacity)} units of storage${c.budgetEnabled ? `, or over the ${money(c.budget)} budget` : ""}). Dots: BO samples in order (amber = warm starts); star: chosen policy.`}
        busy={stale}
        actions={
          <Segmented
            size="sm"
            ariaLabel="Heatmap values"
            value={mode}
            onChange={setMode}
            options={[
              { value: "simulated", label: "Simulated cost" },
              { value: "surrogate", label: "GP surrogate belief" },
            ]}
          />
        }
        explain={
          heatmapStory(e, c.capacity) +
          (mode === "surrogate" ? ` The surrogate view shows what the Gaussian process believed after ${o.bo.evaluations.length} evaluations: it only needs to be accurate near the optimum, not everywhere.` : "")
        }
      >
        <CostHeatmap engine={e} mode={mode} />
      </Panel>

      <Panel title="Baseline: the professor's one-at-a-time manual sweeps" subtitle="ROP = d x L + SS with a fixed 200-unit safety stock, for the current SKU in weekly units" busy={stale} explain={sweepStory(e)}>
        <SweepCharts engine={e} />
      </Panel>
    </div>
  );
}
