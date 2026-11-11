/** Global controls: SKU, scenario presets, policy inputs and optimisation constraints. */
import { RotateCcw, X } from "lucide-react";
import { SCENARIO_KEYS, SCENARIOS } from "../../lib/engine/params";
import { fmt, money } from "../../lib/format";
import { skuSeries, SKU_IDS, useStore } from "../../state/store";
import { Slider, Toggle } from "../ui/Controls";

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const s = useStore();
  if (!s.skus[s.skuId]) return null;
  const c = s.skus[s.skuId].controls;
  const series = skuSeries(s);
  const set = s.setControl;
  const capMax = Math.round(series.defaults.capacity * 2.5);
  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto p-4 pb-10">
      <div className="flex items-center justify-between lg:hidden">
        <span className="text-sm font-semibold text-slate-200">Controls</span>
        <button className="btn min-h-[36px] px-2.5" onClick={onClose} aria-label="Close controls">
          <X className="h-4 w-4" />
        </button>
      </div>

      <section className="space-y-2">
        <h3 className="label">Product (SKU)</h3>
        <div className="grid gap-2">
          {SKU_IDS.map((id) => {
            const sk = skuSeries(s, id);
            const active = s.skuId === id;
            return (
              <button
                key={id}
                onClick={() => s.setSku(id)}
                aria-pressed={active}
                className={`rounded-xl border px-3 py-2.5 text-left transition ${active ? "border-ai/50 bg-ai/10" : "border-white/10 bg-white/[0.03] hover:border-white/20"}`}
              >
                <div className={`text-[13px] font-semibold ${active ? "text-ai" : "text-slate-200"}`}>{sk.label}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-slate-400">
                  {sk.store} / {sk.item} - unit price {money(sk.basePrice)}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="label">Scenario preset</h3>
        <div className="flex flex-wrap gap-1.5">
          {SCENARIO_KEYS.map((k) => (
            <button
              key={k}
              onClick={() => s.setScenario(k)}
              aria-pressed={s.scenarioKey === k}
              title={SCENARIOS[k].description}
              className={`min-h-[34px] rounded-lg border px-2.5 text-xs font-medium transition ${
                s.scenarioKey === k ? (k === "normal" ? "border-ai/50 bg-ai/15 text-ai" : "border-risk/50 bg-risk/15 text-rose-300") : "border-white/10 text-slate-400 hover:border-white/20 hover:text-slate-200"
              }`}
            >
              {SCENARIOS[k].name}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-slate-500">{SCENARIOS[s.scenarioKey].description}</p>
      </section>

      <section className="space-y-3">
        <h3 className="label">Service and lead time</h3>
        <Slider label="Cycle service level (Z)" value={c.serviceLevel} min={0.8} max={0.995} step={0.005} onChange={(v) => set("serviceLevel", v)} format={(v) => `${(v * 100).toFixed(1)}%`} hint="Chance of no stockout per replenishment cycle; sets Z and the Monte Carlo quantile." />
        <Slider label="Lead time L" value={c.leadTime} min={0.5} max={10} step={0.5} onChange={(v) => set("leadTime", v)} format={(v) => `${fmt(v, 1)} wk`} />
        <Slider label="Lead-time variability sigma_L" value={c.leadTimeSd} min={0} max={4} step={0.1} onChange={(v) => set("leadTimeSd", v)} format={(v) => `${fmt(v, 1)} wk`} />
      </section>

      <section className="space-y-3">
        <h3 className="label">Costs</h3>
        <Slider label="Holding cost h" value={c.holdingCost} min={0.1} max={6} step={0.1} onChange={(v) => set("holdingCost", v)} format={(v) => `$${fmt(v, 2)} /unit-wk`} />
        <Slider label="Stockout cost p" value={c.stockoutCost} min={1} max={80} step={1} onChange={(v) => set("stockoutCost", v)} format={(v) => `$${fmt(v)} /unit`} />
        <Slider label="Ordering cost K" value={c.orderCost} min={100} max={6000} step={100} onChange={(v) => set("orderCost", v)} format={(v) => `$${fmt(v)} /order`} />
      </section>

      <section className="space-y-3">
        <h3 className="label">Optimisation constraints</h3>
        <Slider label="Minimum fill rate" value={c.targetFillRate} min={0.9} max={0.995} step={0.005} onChange={(v) => set("targetFillRate", v)} format={(v) => `${(v * 100).toFixed(1)}%`} />
        <Slider label="Storage capacity (s + Q)" value={c.capacity} min={Math.round(series.defaults.capacity * 0.3)} max={capMax} step={50} onChange={(v) => set("capacity", v)} format={(v) => `${fmt(v)} units`} />
        <Toggle checked={c.budgetEnabled} onChange={(v) => set("budgetEnabled", v)} label="Inventory budget constraint" />
        {c.budgetEnabled && (
          <Slider label="Max average inventory value" value={c.budget} min={1000} max={150000} step={1000} onChange={(v) => set("budget", v)} format={(v) => money(v)} />
        )}
      </section>

      <button className="btn" onClick={s.resetControls}>
        <RotateCcw className="h-4 w-4" /> Reset controls and scenario
      </button>

      <p className="text-[11px] leading-snug text-slate-500">Time unit everywhere: weeks. Demand, sigma_D, L and sigma_L are all per week.</p>
    </div>
  );
}
