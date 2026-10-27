import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { ApiError, peekReportCache } from '../api/client';
import { reportApi, type BalanceSheetYear } from '../api/data';
import { Chart } from '../components/Chart';
import { FyPicker, fyShort } from '../components/FyPicker';

const NAVY = '#0b1b4d';
const CRORE = 1_000_000_000;
const STALE = '__stale_backend__';
const METRICS = [
  { key: 'total_equity', label: 'Total Equity', color: '#08ad84', wash: '#e0fbf1', edge: '#a6eed5' },
  { key: 'total_debt', label: 'Total Debt', color: '#1688ef', wash: '#e4f3ff', edge: '#a8d9ff' },
  { key: 'invested_capital', label: 'Invested Capital', color: '#f38a19', wash: '#fff1df', edge: '#ffd3a0' },
] as const;
type MetricKey = typeof METRICS[number]['key'];
type Ratio = { name: string; current: number | null; previous: number | null; suffix?: string };

export function BalanceSheetPage() {
  const [years, setYears] = useState<BalanceSheetYear[] | null>(() => peekReportCache<{ years: BalanceSheetYear[] }>('/api/reports/balance-sheet')?.years ?? null);
  const [fy, setFy] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    void reportApi.balanceSheet().then((data) => {
      if (!live) return;
      setYears(data.years);
      setFy(data.years[data.years.length - 1]?.fy ?? null);
    }).catch((e: Error) => live && setError(e instanceof ApiError && e.status === 404 ? STALE : e.message));
    return () => { live = false; };
  }, []);

  if (error) return <Notice error>{error === STALE ? 'Balance Sheet: the data service is out of date. Close the app completely and start it again.' : error}</Notice>;
  if (!years) return null;
  if (!years.length) return <Notice>No Balance Sheet data is available yet. Upload a Balance Sheet file.</Notice>;
  const selected = years.find((year) => year.fy === fy) ?? years[years.length - 1];
  const previous = years.find((year) => year.fy === selected.fy - 1) ?? null;
  return <BalanceSheetView years={years} current={selected} previous={previous} onChange={setFy} />;
}

function BalanceSheetView({ years, current, previous, onChange }: { years: BalanceSheetYear[]; current: BalanceSheetYear; previous: BalanceSheetYear | null; onChange: (fy: number) => void }) {
  const ratios: Ratio[] = [
    { name: 'Debt to Equity', current: ratio(value(current, 'total_debt'), value(current, 'total_equity')), previous: previous ? ratio(value(previous, 'total_debt'), value(previous, 'total_equity')) : null },
    { name: 'Debt to Invested Capital', current: ratio(value(current, 'total_debt'), value(current, 'invested_capital')), previous: previous ? ratio(value(previous, 'total_debt'), value(previous, 'invested_capital')) : null },
    { name: 'Equity to Invested Capital', current: ratio(value(current, 'total_equity'), value(current, 'invested_capital')), previous: previous ? ratio(value(previous, 'total_equity'), value(previous, 'invested_capital')) : null },
  ];
  const currentRatio = ratios[0];
  return (
    <div className="min-w-0 space-y-4">
        <header className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold uppercase tracking-[0.22em] text-[#1747ad]">Financial Position</div>
              <h1 className="mt-1 font-heading text-3xl font-extrabold tracking-tight text-[#0b1b4d] xl:text-4xl">Balance Sheet Overview</h1>
              <p className="mt-2 text-sm text-[#334e7d] sm:text-base">A clear view of reported equity, debt and invested capital.</p>
            </div>
            <FyPicker fy={current.fy} years={years.map((year) => year.fy)} onChange={onChange} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {METRICS.map((metric) => <MetricCard key={metric.key} metric={metric} current={current} previous={previous} />)}
            <RatioCard ratio={currentRatio} previousLabel={previous ? fyShort(previous.fy) : null} />
          </div>
        </header>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[1.25fr_1fr]">
          <Panel title={`Capital & Debt (${fyShort(current.fy)}, ₹ Cr)`} icon={<BalanceIcon />}>
            <BalanceTable current={current} previous={previous} />
          </Panel>
          <Panel title="Capital Position Trend (₹ Cr)" icon={<BarsIcon />}>
            <CapitalTrend years={years.filter((year) => year.fy <= current.fy).slice(-6)} />
          </Panel>
        </div>

        <div className="grid min-w-0 gap-4 xl:grid-cols-[1fr_1.2fr]">
          <Panel title="Key Financial Ratios" icon={<PercentIcon />}>
            <RatioTable ratios={ratios} previousLabel={previous ? fyShort(previous.fy) : null} currentLabel={fyShort(current.fy)} />
          </Panel>
          <Panel title="Leverage Trend" icon={<TrendIcon />}>
            <LeverageTrend years={years.filter((year) => year.fy <= current.fy).slice(-6)} />
          </Panel>
        </div>

        <div className="flex gap-3 rounded-2xl border border-blue-200 bg-white/80 p-4 text-sm leading-relaxed text-[#294574] shadow-sm">
          <span className="mt-0.5 shrink-0 text-blue-600"><InfoIcon /></span>
          <p>The current Balance Sheet upload template records total equity, total debt and invested capital. Detailed asset and liability categories, working capital balances and liquidity ratios are not included in the uploaded data.</p>
        </div>
    </div>
  );
}

function MetricCard({ metric, current, previous }: { metric: typeof METRICS[number]; current: BalanceSheetYear; previous: BalanceSheetYear | null }) {
  const amount = value(current, metric.key);
  const before = previous ? value(previous, metric.key) : null;
  const change = amount === null || before === null ? null : amount - before;
  const changePct = change === null || !before ? null : change * 100 / Math.abs(before);
  return <div className="relative flex min-h-[124px] min-w-0 items-center gap-3 overflow-hidden rounded-2xl border bg-gradient-to-br p-3 pr-8 shadow-sm" style={{ borderColor: metric.edge, backgroundImage: `linear-gradient(135deg, ${metric.wash}, #ffffff)` }}>
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-white shadow-md" style={{ background: `linear-gradient(145deg, ${metric.color}cc, ${metric.color})` }}>{metric.key === 'total_equity' ? <PeopleIcon /> : metric.key === 'total_debt' ? <BankIcon /> : <InvestmentIcon />}</span>
    <div className="min-w-0"><div className="truncate text-xs font-bold text-[#173b7c]">{metric.label}</div><div className="font-heading text-xl font-extrabold leading-tight text-[#0b1b4d]">{money(amount)}</div>
      {change !== null && <div className={`text-xs font-extrabold ${change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{change >= 0 ? '▲ +' : '▼ '}{fmt(Math.abs(change))}{changePct === null ? '' : ` (${Math.abs(changePct).toFixed(1)}%)`}</div>}
      {before !== null && previous && <div className="truncate text-[10px] font-medium text-[#1747ad]">vs {fyShort(previous.fy)} ({money(before)})</div>}
    </div>
    <div aria-hidden="true" className="absolute bottom-2 right-2 flex h-9 items-end gap-0.5 opacity-70">{[35, 58, 76].map((height, i) => <span key={i} className="w-1.5 rounded-t-sm" style={{ height: `${height}%`, backgroundColor: metric.color }} />)}</div>
  </div>;
}

function RatioCard({ ratio: r, previousLabel }: { ratio: Ratio; previousLabel: string | null }) {
  const difference = r.current === null || r.previous === null ? null : r.current - r.previous;
  return <div className="relative flex min-h-[124px] min-w-0 items-center gap-3 overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-3 shadow-sm">
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-violet-700 text-2xl font-extrabold text-white shadow-md">%</span>
    <div className="min-w-0"><div className="truncate text-xs font-bold text-[#173b7c]">Debt-to-Equity Ratio</div><div className="font-heading text-2xl font-extrabold leading-tight text-[#0b1b4d]">{r.current === null ? '—' : r.current.toFixed(2)}</div>
      {difference !== null && <div className={`text-xs font-extrabold ${difference >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{difference >= 0 ? '▲ +' : '▼ '}{Math.abs(difference).toFixed(2)}</div>}
      <div className="text-[10px] font-medium text-[#1747ad]">{previousLabel ? `vs ${previousLabel}` : 'Debt / Equity'}</div>
    </div>
  </div>;
}

function BalanceTable({ current, previous }: { current: BalanceSheetYear; previous: BalanceSheetYear | null }) {
  return <div className="overflow-hidden p-3"><table className="w-full table-fixed border-collapse text-[11px] leading-tight text-[#0b1b4d] sm:text-xs"><colgroup><col className="w-[36%]" /><col className="w-[20%]" /><col className="w-[20%]" /><col className="w-[12%]" /><col className="w-[12%]" /></colgroup>
    <thead><tr className="bg-[#173f91] text-white"><th className="px-1.5 py-2 text-left sm:px-2">Particulars</th><th className="px-1 py-2 text-right sm:px-2">{fyShort(current.fy)}</th><th className="px-1 py-2 text-right sm:px-2">{previous ? fyShort(previous.fy) : 'Prior FY'}</th><th className="px-1 py-2 text-right sm:px-2">Change</th><th className="px-1 py-2 text-right sm:px-2">Change %</th></tr></thead>
    <tbody>{METRICS.map((metric) => {
      const now = value(current, metric.key), before = previous ? value(previous, metric.key) : null;
      const delta = now === null || before === null ? null : now - before;
      const pct = delta === null || !before ? null : delta * 100 / Math.abs(before);
      return <tr key={metric.key} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]"><td className="break-words px-1.5 py-3 font-semibold sm:px-2">{metric.label}</td><td className="px-1 py-3 text-right tabular-nums sm:px-2">{fmt(now)}</td><td className="px-1 py-3 text-right tabular-nums sm:px-2">{fmt(before)}</td><td className={`px-1 py-3 text-right font-semibold tabular-nums sm:px-2 ${delta === null ? '' : delta >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{signed(delta)}</td><td className={`px-1 py-3 text-right font-semibold tabular-nums sm:px-2 ${pct === null ? '' : pct >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{pct === null ? '—' : `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`}</td></tr>;
    })}</tbody>
  </table></div>;
}

function RatioTable({ ratios, previousLabel, currentLabel }: { ratios: Ratio[]; previousLabel: string | null; currentLabel: string }) {
  return <div className="overflow-hidden p-3"><table className="w-full table-fixed border-collapse text-xs text-[#0b1b4d]"><colgroup><col className="w-[44%]" /><col className="w-[19%]" /><col className="w-[19%]" /><col className="w-[18%]" /></colgroup>
    <thead><tr className="bg-[#e9f2fc] text-[#173b7c]"><th className="px-2 py-2 text-left">Ratio</th><th className="px-1 py-2 text-right">{currentLabel}</th><th className="px-1 py-2 text-right">{previousLabel ?? 'Previous'}</th><th className="px-1 py-2 text-right">Change</th></tr></thead>
    <tbody>{ratios.map((r) => <tr key={r.name} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]"><td className="break-words px-2 py-3 font-semibold">{r.name}</td><td className="px-1 py-3 text-right tabular-nums">{r.current === null ? '—' : r.current.toFixed(2)}</td><td className="px-1 py-3 text-right tabular-nums">{r.previous === null ? '—' : r.previous.toFixed(2)}</td><td className={`px-1 py-3 text-right font-semibold tabular-nums ${r.current === null || r.previous === null ? '' : r.current >= r.previous ? 'text-emerald-700' : 'text-rose-600'}`}>{r.current === null || r.previous === null ? '—' : `${r.current >= r.previous ? '+' : '−'}${Math.abs(r.current - r.previous).toFixed(2)}`}</td></tr>)}</tbody>
  </table><p className="px-1 pt-3 text-[11px] text-slate-500">Ratios are calculated only when both required reported values are available.</p></div>;
}

function CapitalTrend({ years }: { years: BalanceSheetYear[] }) {
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: NAVY, fontSize: 11 } },
    grid: { left: 48, right: 12, top: 40, bottom: 34 },
    xAxis: { type: 'category', data: years.map((year) => fyShort(year.fy)), axisTick: { show: false }, axisLine: { lineStyle: { color: '#a8bad3' } }, axisLabel: { color: NAVY, fontWeight: 600 } },
    yAxis: { type: 'value', name: '₹ Cr', nameTextStyle: { color: NAVY }, axisLabel: { color: NAVY }, splitLine: { lineStyle: { color: '#e6edf7' } } },
    series: METRICS.map((metric) => ({ name: metric.label, type: 'bar', barMaxWidth: 22, data: years.map((year) => toCr(value(year, metric.key))), itemStyle: { color: metric.color, borderRadius: [3, 3, 0, 0] } })),
  }), [years]);
  return years.length ? <div className="h-[290px] px-1"><Chart option={option} className="h-full w-full" /></div> : <div className="grid h-[290px] place-items-center text-sm text-slate-500">Upload balance sheet figures to see the trend.</div>;
}

function LeverageTrend({ years }: { years: BalanceSheetYear[] }) {
  const option = useMemo<EChartsCoreOption>(() => ({
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${Number(v).toFixed(2)}x` },
    grid: { left: 48, right: 18, top: 24, bottom: 34 },
    xAxis: { type: 'category', data: years.map((year) => fyShort(year.fy)), axisTick: { show: false }, axisLine: { lineStyle: { color: '#a8bad3' } }, axisLabel: { color: NAVY, fontWeight: 600 } },
    yAxis: { type: 'value', name: 'Debt / equity', nameTextStyle: { color: NAVY }, axisLabel: { color: NAVY, formatter: '{value}x' }, splitLine: { lineStyle: { color: '#e6edf7' } } },
    series: [{ name: 'Debt to Equity', type: 'line', smooth: true, symbolSize: 9, data: years.map((year) => ratio(value(year, 'total_debt'), value(year, 'total_equity'))), lineStyle: { color: '#7b3fe4', width: 3 }, itemStyle: { color: '#7b3fe4' }, areaStyle: { color: 'rgba(123,63,228,.12)' }, label: { show: true, position: 'top', formatter: ({ value: v }: { value: number | null }) => v === null ? '—' : `${v.toFixed(2)}x`, color: '#6433c2', fontWeight: 700, fontSize: 10 } }],
  }), [years]);
  return years.length ? <div className="h-[290px] px-1"><Chart option={option} className="h-full w-full" /></div> : <div className="grid h-[290px] place-items-center text-sm text-slate-500">Upload equity and debt figures to see leverage.</div>;
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-sky-100 bg-white/95 shadow-sm"><div className="flex items-center gap-2 px-4 pt-3 font-heading text-lg font-bold text-[#0b1b4d]"><span className="text-blue-600">{icon}</span>{title}</div>{children}</section>;
}

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) { return <div className={`rounded-2xl border bg-white p-8 text-center ${error ? 'border-rose-200 text-rose-600' : 'border-sky-200 text-slate-600'}`}>{children}</div>; }
function value(year: BalanceSheetYear, key: MetricKey) { return year.values[key] ?? null; }
function ratio(numerator: number | null, denominator: number | null) { return numerator === null || denominator === null || !denominator ? null : numerator / denominator; }
function fmt(paise: number | null) { return paise === null ? '—' : (paise / CRORE).toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
function money(paise: number | null) { return paise === null ? '—' : `₹${fmt(paise)} Cr`; }
function toCr(paise: number | null) { return paise === null ? null : Number((paise / CRORE).toFixed(2)); }
function signed(value: number | null) { return value === null ? '—' : `${value >= 0 ? '+' : '−'}${fmt(Math.abs(value))}`; }

function BalanceIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 8h18L12 3 3 8Zm2 2v8m5-8v8m4-8v8m5-8v8M3 21h18M2 18h20" /></svg>; }
function BarsIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></svg>; }
function PeopleIcon() { return <svg width="27" height="27" viewBox="0 0 28 28" fill="currentColor" aria-hidden="true"><circle cx="10" cy="8" r="4" /><circle cx="20" cy="10" r="3" /><path d="M2 23v-2a8 8 0 0 1 16 0v2H2Zm16 0v-2a7 7 0 0 0-2-5 6 6 0 0 1 10 5v2h-8Z" /></svg>; }
function BankIcon() { return <svg width="27" height="27" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m3 10 11-7 11 7H3Zm2 2v10m6-10v10m6-10v10m6-10v10M3 25h22M2 22h24" /></svg>; }
function InvestmentIcon() { return <svg width="27" height="27" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 23h20M7 19V9h14v10M10 9V5h8v4M11 13v3m6-3v3" /><circle cx="14" cy="6" r="2" /></svg>; }
function PercentIcon() { return <span className="font-heading text-xl font-extrabold">%</span>; }
function TrendIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19 10 13l4 4 7-9M15 8h6v6" /></svg>; }
function InfoIcon() { return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></svg>; }
