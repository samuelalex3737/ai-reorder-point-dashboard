import { useState } from "react";
import { ForecastChart, VersionChart } from "../components/charts/forecastCharts";
import { Panel } from "../components/ui/Panel";
import { MODEL_INFO, type ModelKey } from "../lib/forecast/pipeline";
import { fmt, shortDate } from "../lib/format";
import { forecastStory, leaderboardStory, versionStory } from "../lib/narrative";
import { useForecast, useSku } from "../state/hooks";
import { DataIntake } from "./DataIntake";
import { Loading } from "./Loading";

type SortKey = "mape" | "wape" | "rmse" | "bias";

export function Forecasting() {
  const { entry, stale } = useForecast();
  const { series, state, history } = useSku();
  const [compare, setCompare] = useState<ModelKey | null>(null);
  const [sort, setSort] = useState<SortKey>("wape");
  if (!entry) return <Loading what="the out-of-sample model comparison" />;
  const r = entry.result;
  const rows = [...r.models].sort((a, b) => (sort === "bias" ? Math.abs(a.metrics.bias) - Math.abs(b.metrics.bias) : a.metrics[sort] - b.metrics[sort]));
  const versions = state.versions;

  return (
    <div className="space-y-4">
      <Panel
        title="Forecast vs actual demand with uncertainty bands"
        subtitle={`${series.label}: best model's one-step-ahead test predictions, then a ${52}-week forecast with 80% and 95% intervals. Drag on the chart to zoom.`}
        busy={stale}
        explain={forecastStory(r, series.label)}
      >
        <ForecastChart history={history} result={r} compareKey={compare} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Panel
          className="xl:col-span-3"
          title="Model leaderboard (out-of-sample)"
          subtitle={`Trained on ${r.trainRows} weeks before ${shortDate(r.testWeeks[0])}, tested on the next ${r.testActual.length} weeks one step ahead. Click a row to overlay it; click a header to sort.`}
          busy={stale}
          explain={leaderboardStory(r)}
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-[13px]">
              <thead className="text-[11px] uppercase tracking-wider text-slate-400">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-2 font-semibold">#</th>
                  <th className="py-2 pr-3 font-semibold">Model</th>
                  <th className="py-2 pr-3 font-semibold">Family</th>
                  {(["mape", "wape", "rmse", "bias"] as SortKey[]).map((k) => (
                    <th key={k} className="py-2 pr-3 text-right font-semibold">
                      <button className={`uppercase ${sort === k ? "text-ai" : "hover:text-slate-200"}`} onClick={() => setSort(k)} aria-pressed={sort === k}>
                        {k === "mape" ? "MAPE %" : k === "wape" ? "WAPE %" : k === "rmse" ? "RMSE (units)" : "Bias %"}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((m, i) => (
                  <tr
                    key={m.key}
                    onClick={() => setCompare(compare === m.key ? null : m.key)}
                    className={`cursor-pointer border-b border-white/[0.05] transition hover:bg-white/[0.04] ${compare === m.key ? "bg-baseline/10" : m.key === r.bestKey ? "bg-ai/[0.07]" : ""}`}
                  >
                    <td className="num py-2 pr-2 text-slate-500">{i + 1}</td>
                    <td className="py-2 pr-3 font-medium text-slate-100">
                      {MODEL_INFO[m.key].name}
                      {m.key === r.bestKey && <span className="ml-2 rounded-md bg-ai/20 px-1.5 py-0.5 text-[10px] font-semibold text-ai">BEST</span>}
                      {compare === m.key && <span className="ml-2 rounded-md bg-baseline/20 px-1.5 py-0.5 text-[10px] font-semibold text-baseline">SHOWN</span>}
                    </td>
                    <td className="py-2 pr-3 text-slate-400">{MODEL_INFO[m.key].family}</td>
                    <td className="num py-2 pr-3 text-right">{fmt(m.metrics.mape, 2)}</td>
                    <td className="num py-2 pr-3 text-right font-semibold">{fmt(m.metrics.wape, 2)}</td>
                    <td className="num py-2 pr-3 text-right">{fmt(m.metrics.rmse, 1)}</td>
                    <td className="num py-2 pr-3 text-right">{fmt(m.metrics.bias, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            LSTM: {entry.lstm.status}
            {entry.lstm.epochsThisRun > 0 ? ` (${entry.lstm.epochsThisRun} epochs this run, ${fmt(entry.lstm.millis / 1000, 1)} s)` : ""}. Pipeline time {fmt(entry.millis / 1000, 1)} s in a background worker. sigma_D = {fmt(r.sigmaD, 2)} units/week.
          </p>
        </Panel>
        <div className="xl:col-span-2">
          <DataIntake />
        </div>
      </div>

      <Panel
        title="Model version log"
        subtitle="Every data change retrains the models; each version records what the dashboard learned"
        busy={stale}
        explain={versionStory(versions)}
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="max-h-[300px] overflow-auto">
            <table className="w-full min-w-[560px] text-left text-[12.5px]">
              <thead className="sticky top-0 bg-ink-850 text-[11px] uppercase tracking-wider text-slate-400">
                <tr className="border-b border-white/10">
                  <th className="py-2 pr-2 font-semibold">Ver.</th>
                  <th className="py-2 pr-2 font-semibold">Change</th>
                  <th className="py-2 pr-2 text-right font-semibold">Rows</th>
                  <th className="py-2 pr-2 font-semibold">Best model</th>
                  <th className="py-2 pr-2 text-right font-semibold">WAPE %</th>
                  <th className="py-2 pr-2 text-right font-semibold">sigma_D</th>
                  <th className="py-2 text-right font-semibold">ROP</th>
                </tr>
              </thead>
              <tbody>
                {[...versions].reverse().map((v) => (
                  <tr key={v.version} className="border-b border-white/[0.05]">
                    <td className="num py-1.5 pr-2 text-slate-300">v{v.version}</td>
                    <td className="py-1.5 pr-2 text-slate-300">{v.trigger}</td>
                    <td className="num py-1.5 pr-2 text-right">{v.rows}</td>
                    <td className="py-1.5 pr-2">{v.bestModel}</td>
                    <td className="num py-1.5 pr-2 text-right">{fmt(v.wape, 2)}</td>
                    <td className="num py-1.5 pr-2 text-right">{fmt(v.sigmaD, 1)}</td>
                    <td className="num py-1.5 text-right">{v.rop === null ? "..." : fmt(v.rop)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h3 className="mb-1 text-[13px] font-semibold text-slate-200">Forecast error across versions</h3>
            <VersionChart versions={versions} />
          </div>
        </div>
      </Panel>
    </div>
  );
}
