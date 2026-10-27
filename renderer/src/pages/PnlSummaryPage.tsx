import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { ApiError, peekReportCache } from '../api/client';
import { reportApi, type DashboardData, type MarginYear } from '../api/data';
import { Chart } from '../components/Chart';
import { FyPicker, fyShort } from '../components/FyPicker';
import { buildRows, type Row } from './MarginsPage';

const NAVY = '#0b1b4d';
const BLUE = '#1677e8';
const TEAL = '#0eaa8a';
const ORANGE = '#f28b20';
const PURPLE = '#7b3fe4';
const PINK = '#e83e83';
const CRORE = 1_000_000_000;
const STALE = '__stale_backend__';

type Metric = { name: string; value: number | null; previous: number | null; color: string; format?: 'percent' };
const CARD_TONES = [
  { wash: '#e4f3ff', edge: '#a8d9ff', icon: '#1688ef' },
  { wash: '#e0fbf1', edge: '#a6eed5', icon: '#08ad84' },
  { wash: '#fff1df', edge: '#ffd3a0', icon: '#f38a19' },
  { wash: '#f2eaff', edge: '#d9c0ff', icon: '#873fe8' },
  { wash: '#ffeaf1', edge: '#ffc1d2', icon: '#e83e83' },
  { wash: '#e4f3ff', edge: '#a8d9ff', icon: '#1688ef' },
];

export function PnlSummaryPage() {
  const [years, setYears] = useState<MarginYear[] | null>(() => peekReportCache<{ years: MarginYear[] }>('/api/reports/margins')?.years ?? null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(() => peekReportCache('/api/reports/dashboard') ?? null);
  const [fy, setFy] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void Promise.all([reportApi.margins(), reportApi.dashboard()])
      .then(([marginData, dashboardData]) => {
        if (!live) return;
        setYears(marginData.years);
        setDashboard(dashboardData);
        setFy(dashboardData.fy);
      })
      .catch((e: Error) => live && setError(e instanceof ApiError && e.status === 404 ? STALE : e.message));
    return () => { live = false; };
  }, []);

  if (error) return <Notice error>{error === STALE ? 'P&L Summary: the data service is out of date. Close the app completely and start it again.' : error}</Notice>;
  if (!years || !dashboard) return null;
  if (!years.length) return <Notice>No sales or Profit &amp; Loss data is available yet. Upload a Sales Register or Profit and loss file.</Notice>;
  const selectedFy = fy ?? dashboard.fy ?? years[years.length - 1].fy;
  return <PnlSummaryView years={years} dashboard={dashboard} fy={selectedFy} onChange={setFy} />;
}

function PnlSummaryView({ years, dashboard, fy, onChange }: { years: MarginYear[]; dashboard: DashboardData; fy: number; onChange: (fy: number) => void }) {
  const availableFys = [...new Set([...dashboard.available_fys, ...years.map((year) => year.fy)])].sort((a, b) => b - a);
  const rows = years.flatMap((year) => buildRows([year])).filter((r) => r.fy <= fy);
  const current = rows.find((r) => r.fy === fy) ?? rows[rows.length - 1];
  const previous = rows.find((r) => r.fy === current.fy - 1) ?? null;
  const currentRaw = years.find((r) => r.fy === current.fy);
  const partial = current.partial;
  const metrics: Metric[] = [
    { name: 'Total Revenue', value: current.revenue, previous: previous?.revenue ?? null, color: BLUE },
    { name: 'Gross Profit', value: current.gross, previous: previous?.gross ?? null, color: TEAL },
    { name: 'EBITDA', value: current.ebitda, previous: previous?.ebitda ?? null, color: ORANGE },
    { name: 'Operating Profit (EBIT)', value: current.operating, previous: previous?.operating ?? null, color: PURPLE },
    { name: 'Net Profit (PAT)', value: current.pat, previous: previous?.pat ?? null, color: PINK },
    { name: 'Net Margin', value: current.patM, previous: previous?.patM ?? null, color: BLUE, format: 'percent' },
  ];
  const revenueChange = change(current.revenue, previous?.revenue ?? null);
  const patChange = change(current.pat, previous?.pat ?? null);
  const fcf = dashboard.years.find((y) => y.fy === current.fy)?.free_cash_flow_paise ?? null;
  const prevFcf = dashboard.years.find((y) => y.fy === current.fy - 1)?.free_cash_flow_paise ?? null;
  const headline = current.patM === null
    ? 'Financial performance at a glance'
    : current.patM >= (previous?.patM ?? 0) ? 'Profitability supported by healthy margins' : 'Revenue and profitability performance';

  return (
    <div className="min-w-0 space-y-4">
      <header className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold uppercase tracking-[0.22em] text-[#1747ad]">P&amp;L Summary</div>
            <h1 className="mt-1 font-heading text-3xl font-extrabold tracking-tight text-[#0b1b4d] xl:text-4xl">{headline}</h1>
            <p className="mt-2 text-sm text-[#334e7d] sm:text-base">Revenue, profit and margin trends for {fyShort(current.fy)}{partial ? ' to date' : ''}.</p>
          </div>
          <FyPicker fy={current.fy} years={availableFys} onChange={onChange} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          {metrics.map((m, i) => <MetricCard key={m.name} metric={m} index={i} currentLabel={current.label} previousLabel={previous?.label ?? null} />)}
        </div>
      </header>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Panel title="P&L Trend (₹ Cr)" icon={<BarsIcon />}>
          <TrendChart rows={rows.slice(-5)} />
        </Panel>
        <Panel title={`P&L Breakdown – ${fyShort(current.fy)} (₹ Cr)`} icon={<PieIcon />}>
          <Breakdown row={current} pnl={currentRaw?.pnl ?? null} />
        </Panel>
      </div>

      <div className="grid min-w-0 gap-4 2xl:grid-cols-3">
        <Panel title={`Key P&amp;L Metrics (${fyShort(current.fy)})`} icon={<DocIcon />}>
          <MetricTable current={current} previous={previous} />
        </Panel>
        <Panel title="Margin Trends (%)" icon={<PercentIcon />}>
          <MarginChart rows={rows.slice(-5)} />
        </Panel>
        <Panel title="Cash Flow Summary (₹ Cr)" icon={<CashIcon />}>
          <CashFlowTable years={dashboard.years.filter((y) => y.fy <= current.fy).slice(-5)} />
          <div className="mx-3 mt-2 flex items-center justify-between rounded-xl border border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50 px-3 py-2">
            <div><div className="text-xs font-bold text-orange-700">Free Cash Flow</div><div className="font-heading text-xl font-extrabold text-[#0b1b4d]">{money(fcf)}</div></div>
            <div className="text-right text-sm font-bold text-emerald-700">{fcfChange(fcf, prevFcf)}<div className="text-xs font-medium text-slate-600">vs {fyShort(current.fy - 1)}</div></div>
          </div>
          <p className="px-3 pt-2 text-[11px] text-slate-500">Free cash flow is operating cash flow less capital expenditure. Component cash flow figures are not available in this report.</p>
        </Panel>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Panel title="Key Highlights" icon={<BulbIcon />}>
          <Highlights current={current} previous={previous} fcf={fcf} />
        </Panel>
        <Panel title="Outlook / Key Takeaways" icon={<TargetIcon />}>
          <Takeaways current={current} previous={previous} revenueChange={revenueChange} patChange={patChange} />
        </Panel>
      </div>
      {partial && <p className="px-1 text-xs text-slate-500">{fyShort(current.fy)} is a part-year. Revenue comparisons use the figures currently available.</p>}
    </div>
  );
}

function MetricCard({ metric, index, currentLabel, previousLabel }: { metric: Metric; index: number; currentLabel: string; previousLabel: string | null }) {
  const tone = CARD_TONES[index % CARD_TONES.length];
  const formatted = metric.value === null ? '—' : metric.format === 'percent' ? `${metric.value.toFixed(1)}%` : money(metric.value);
  const delta = metric.value === null || metric.previous === null ? null : metric.format === 'percent'
    ? metric.value - metric.previous
    : change(metric.value, metric.previous);
  const deltaLabel = delta === null ? null : metric.format === 'percent' ? `${delta >= 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pp` : `${delta >= 0 ? '▲ +' : '▼ '}${Math.abs(delta).toFixed(1)}%`;
  return (
    <div className="relative flex min-h-[112px] min-w-0 items-center gap-3 overflow-hidden rounded-2xl border bg-gradient-to-br p-3 pr-7 shadow-sm" style={{ borderColor: tone.edge, backgroundImage: `linear-gradient(135deg, ${tone.wash}, #ffffff)` }}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-white shadow-md" style={{ background: `linear-gradient(145deg, ${tone.icon}cc, ${tone.icon})` }}><MetricIcon index={index} /></span>
      <div className="min-w-0">
        <div className="truncate text-xs font-bold text-[#173b7c]">{metric.name}</div>
        <div className="font-heading text-xl font-extrabold leading-tight text-[#0b1b4d]">{formatted}</div>
        {deltaLabel && <div className={`text-xs font-extrabold ${delta !== null && delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{deltaLabel}</div>}
        {metric.value === null ? <div className="text-[10px] text-slate-500">Needs P&amp;L upload</div>
          : metric.previous !== null && previousLabel && <div className="truncate text-[10px] font-medium text-[#1747ad]">vs {previousLabel} ({metric.format === 'percent' ? `${metric.previous.toFixed(1)}%` : money(metric.previous)})</div>}
      </div>
      <div aria-hidden="true" className="absolute bottom-2 right-2 flex h-9 items-end gap-0.5 opacity-70">
        {[35, 58, 76].map((height, i) => <span key={i} className="w-1.5 rounded-t-sm" style={{ height: `${height}%`, backgroundColor: tone.icon }} />)}
      </div>
    </div>
  );
}

function MetricIcon({ index }: { index: number }) {
  if (index === 1) return <CoinStackIcon />;
  if (index === 2) return <span className="text-2xl leading-none">⚙</span>;
  if (index === 3) return <TrendIcon />;
  if (index === 4) return <CashIcon />;
  if (index === 5) return <span className="font-heading text-2xl font-extrabold">%</span>;
  return <BarsIcon />;
}

function CoinStackIcon() {
  return <svg width="27" height="27" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><ellipse cx="11" cy="7" rx="7" ry="3" /><path d="M4 7v4c0 1.7 3.1 3 7 3 .8 0 1.6-.1 2.3-.2M4 11v4c0 1.7 3.1 3 7 3 .8 0 1.6-.1 2.3-.2M4 15v4c0 1.7 3.1 3 7 3 1 0 2-.1 2.8-.4M17 13c3.9 0 7 1.3 7 3s-3.1 3-7 3-7-1.3-7-3 3.1-3 7-3Z" /><path d="M10 16v4c0 1.7 3.1 3 7 3s7-1.3 7-3v-4m-14 4v3c0 1.7 3.1 3 7 3s7-1.3 7-3v-3" /></svg>;
}

function TrendIcon() {
  return <svg width="27" height="27" viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 21 11 14l4 4L24 8" /><path d="M17 8h7v7" /></svg>;
}

function TrendChart({ rows }: { rows: Row[] }) {
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif" },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, textStyle: { color: NAVY, fontSize: 11 } },
    grid: { left: 48, right: 12, top: 42, bottom: 32 },
    xAxis: { type: 'category', data: rows.map((r) => r.label), axisTick: { show: false }, axisLine: { lineStyle: { color: '#a8bad3' } }, axisLabel: { color: NAVY, fontWeight: 600 } },
    yAxis: { type: 'value', name: '₹ Cr', nameTextStyle: { color: NAVY }, axisLabel: { color: NAVY }, splitLine: { lineStyle: { color: '#e6edf7' } } },
    series: [
      { name: 'Revenue', type: 'bar', barMaxWidth: 28, data: rows.map((r) => crValue(r.revenue)), itemStyle: { color: BLUE, borderRadius: [3, 3, 0, 0] }, label: { show: true, position: 'top', color: NAVY, fontSize: 10, fontWeight: 700 } },
      { name: 'Gross Profit', type: 'bar', barMaxWidth: 24, data: rows.map((r) => crNullable(r.gross)), itemStyle: { color: TEAL, borderRadius: [3, 3, 0, 0] } },
      { name: 'EBITDA', type: 'bar', barMaxWidth: 22, data: rows.map((r) => crNullable(r.ebitda)), itemStyle: { color: ORANGE, borderRadius: [3, 3, 0, 0] } },
      { name: 'Net Profit', type: 'bar', barMaxWidth: 20, data: rows.map((r) => crNullable(r.pat)), itemStyle: { color: PURPLE, borderRadius: [3, 3, 0, 0] } },
    ],
  }), [rows]);
  return <div className="h-[300px] px-1"><Chart option={option} className="h-full w-full" /></div>;
}

function Breakdown({ row, pnl }: { row: Row; pnl: Record<string, number> | null }) {
  const parts = pnl ? [
    { name: 'Cost of Goods Sold (COGS)', value: pnl.cogs ?? 0, color: BLUE },
    { name: 'Operating Expenses (Opex)', value: pnl.opex ?? 0, color: TEAL },
    { name: 'Depreciation & Amortisation', value: pnl.depreciation_amortisation ?? 0, color: ORANGE },
    { name: 'Operating Profit (EBIT)', value: row.operating ?? 0, color: PURPLE },
  ].filter((p) => p.value > 0) : [];
  const option = useMemo<EChartsCoreOption>(() => ({
    tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}: ${money(p.value)} (${p.percent.toFixed(1)}%)` },
    series: [{ type: 'pie', radius: ['52%', '84%'], center: ['50%', '50%'], minShowLabelAngle: 8, itemStyle: { borderColor: '#fff', borderWidth: 2 }, label: { show: true, color: '#fff', fontWeight: 800, formatter: ({ percent }: { percent: number }) => `${percent.toFixed(0)}%` }, data: parts.map((p) => ({ name: p.name, value: p.value, itemStyle: { color: p.color } })) }],
  }), [parts]);
  if (!pnl || !parts.length) return <div className="grid h-[290px] place-items-center p-6 text-center text-sm text-slate-600">Upload Profit and loss data to see the revenue breakdown.</div>;
  return (
    <div className="grid items-center gap-2 p-2 sm:grid-cols-[minmax(170px,0.9fr)_1.1fr]">
      <div className="relative h-[280px] min-w-0">
        <Chart option={option} className="h-full w-full" />
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-[#0b1b4d]"><div><b className="font-heading text-xl">{money(row.revenue)}</b><div className="text-xs">Total Revenue<br />{row.label}</div></div></div>
      </div>
      <div className="space-y-3 px-2">
        {parts.map((p) => <div key={p.name} className="flex items-center gap-2 text-xs text-[#183568] sm:text-sm"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: p.color }} /><span className="min-w-0 flex-1">{p.name}</span><b className="whitespace-nowrap">{money(p.value)}</b><span className="w-12 text-right">{row.revenue ? `${(p.value * 100 / row.revenue).toFixed(0)}%` : '—'}</span></div>)}
      </div>
    </div>
  );
}

function MetricTable({ current, previous }: { current: Row; previous: Row | null }) {
  const items: [string, number | null, number | null][] = [
    ['Total Revenue', current.revenue, previous?.revenue ?? null], ['Gross Profit', current.gross, previous?.gross ?? null],
    ['EBITDA', current.ebitda, previous?.ebitda ?? null], ['Operating Profit (EBIT)', current.operating, previous?.operating ?? null], ['Net Profit (PAT)', current.pat, previous?.pat ?? null],
  ];
  return <div className="overflow-hidden p-3"><table className="w-full table-fixed border-collapse text-[11px] leading-tight text-[#0b1b4d] sm:text-xs"><colgroup><col className="w-[39%]" /><col className="w-[20%]" /><col className="w-[20%]" /><col className="w-[21%]" /></colgroup><thead><tr className="bg-[#173f91] text-white"><th className="px-1.5 py-2 text-left font-bold sm:px-2">Metric</th><th className="px-1 py-2 text-right font-bold sm:px-2">{current.label} (₹ Cr)</th><th className="px-1 py-2 text-right font-bold sm:px-2">{previous?.label ?? 'Previous'} (₹ Cr)</th><th className="px-1 py-2 text-right font-bold sm:px-2">Change</th></tr></thead><tbody>{items.map(([name, value, before]) => { const d = value === null || before === null ? null : value - before; return <tr key={name} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]"><td className="break-words px-1.5 py-2 font-semibold sm:px-2">{name}</td><td className="px-1 py-2 text-right tabular-nums sm:px-2">{num(value)}</td><td className="px-1 py-2 text-right tabular-nums sm:px-2">{num(before)}</td><td className={`px-1 py-2 text-right font-semibold tabular-nums sm:px-2 ${d === null ? '' : d >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{d === null ? '—' : `${d >= 0 ? '+' : '−'}${num(Math.abs(d))}`}</td></tr>; })}</tbody></table></div>;
}

function MarginChart({ rows }: { rows: Row[] }) {
  const option: EChartsCoreOption = {
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` }, legend: { top: 0, textStyle: { color: NAVY, fontSize: 11 } },
    grid: { left: 44, right: 14, top: 42, bottom: 30 }, xAxis: { type: 'category', data: rows.map((r) => r.label), axisTick: { show: false }, axisLabel: { color: NAVY }, axisLine: { lineStyle: { color: '#a8bad3' } } },
    yAxis: { type: 'value', axisLabel: { color: NAVY, formatter: '{value}%' }, splitLine: { lineStyle: { color: '#e6edf7' } } },
    series: [
      { name: 'Gross Margin', type: 'line', smooth: true, symbolSize: 7, data: rows.map((r) => r.grossM === null ? null : Number(r.grossM.toFixed(1))), lineStyle: { color: BLUE, width: 3 }, itemStyle: { color: BLUE }, label: { show: true, position: 'top', formatter: '{c}%', color: BLUE, fontWeight: 700, fontSize: 10 } },
      { name: 'EBITDA Margin', type: 'line', smooth: true, symbolSize: 7, data: rows.map((r) => r.ebitda === null || !r.revenue ? null : Number((r.ebitda * 100 / r.revenue).toFixed(1))), lineStyle: { color: TEAL, width: 3 }, itemStyle: { color: TEAL }, label: { show: true, position: 'top', formatter: '{c}%', color: TEAL, fontWeight: 700, fontSize: 10 } },
      { name: 'Net Margin', type: 'line', smooth: true, symbolSize: 7, data: rows.map((r) => r.patM === null ? null : Number(r.patM.toFixed(1))), lineStyle: { color: ORANGE, width: 3 }, itemStyle: { color: ORANGE }, label: { show: true, position: 'bottom', formatter: '{c}%', color: '#b45309', fontWeight: 700, fontSize: 10 } },
    ],
  };
  return <div className="h-[300px] px-1"><Chart option={option} className="h-full w-full" /></div>;
}

function CashFlowTable({ years }: { years: DashboardData['years'] }) {
  const rows = years.map((y, i) => {
    const before = years[i - 1]?.free_cash_flow_paise ?? null;
    const current = y.free_cash_flow_paise;
    const delta = current === null || before === null ? null : current - before;
    return { label: fyShort(y.fy), current, before, delta };
  });
  return <div className="overflow-hidden p-3"><table className="w-full table-fixed border-collapse text-[10px] leading-tight text-[#0b1b4d] sm:text-xs"><colgroup><col className="w-[27%]" /><col className="w-[25%]" /><col className="w-[25%]" /><col className="w-[23%]" /></colgroup><thead><tr className="bg-[#173f91] text-white"><th className="px-1.5 py-2 text-left font-bold sm:px-2">Free Cash Flow</th><th className="px-1 py-2 text-right font-bold sm:px-2">Current (₹ Cr)</th><th className="px-1 py-2 text-right font-bold sm:px-2">Previous (₹ Cr)</th><th className="px-1 py-2 text-right font-bold sm:px-2">Change</th></tr></thead><tbody>{rows.map((r) => <tr key={r.label} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]"><td className="px-1.5 py-2 font-semibold sm:px-2">{r.label}</td><td className="px-1 py-2 text-right tabular-nums sm:px-2">{num(r.current)}</td><td className="px-1 py-2 text-right tabular-nums sm:px-2">{num(r.before)}</td><td className={`px-1 py-2 text-right font-semibold tabular-nums sm:px-2 ${r.delta === null ? '' : r.delta >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{r.delta === null ? '—' : `${r.delta >= 0 ? '+' : '−'}${num(Math.abs(r.delta))}`}</td></tr>)}</tbody></table></div>;
}

function Highlights({ current, previous, fcf }: { current: Row; previous: Row | null; fcf: number | null }) {
  const items = [
    { color: BLUE, title: 'Revenue', text: previous ? `${growthText(current.revenue, previous.revenue)} from ${previous.label} to ${current.label}.` : `Revenue is ${money(current.revenue)} for ${current.label}.` },
    { color: TEAL, title: 'Gross Profit', text: current.gross === null ? 'Upload P&L data to show gross profit.' : `${money(current.gross)} gross profit${current.grossM === null ? '' : ` at a ${current.grossM.toFixed(1)}% margin`}.` },
    { color: ORANGE, title: 'Free Cash Flow', text: fcf === null ? 'Upload Cash flow data to show free cash flow.' : `Free cash flow is ${money(fcf)}.` },
    { color: PURPLE, title: 'Net Margin', text: current.patM === null ? 'Upload P&L data to show net margin.' : `Net margin is ${current.patM.toFixed(1)}%.` },
  ];
  return <div className="grid gap-2 p-3 sm:grid-cols-2">{items.map((x) => <div key={x.title} className="flex gap-3 rounded-xl border p-3" style={{ borderColor: `${x.color}55`, background: `${x.color}0b` }}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white" style={{ background: x.color }}><BarsIcon /></span><div><b className="text-sm" style={{ color: x.color }}>{x.title}</b><p className="text-xs leading-snug text-[#263f6d]">{x.text}</p></div></div>)}</div>;
}

function Takeaways({ current, previous, revenueChange, patChange }: { current: Row; previous: Row | null; revenueChange: number | null; patChange: number | null }) {
  const items = [
    revenueChange === null ? `${current.label} revenue is ${money(current.revenue)}.` : `Revenue ${revenueChange >= 0 ? 'grew' : 'declined'} ${Math.abs(revenueChange).toFixed(1)}% vs ${previous?.label}.`,
    current.operating === null ? 'Operating profit is waiting for a Profit and loss upload.' : `Operating profit (EBIT) is ${money(current.operating)}.`,
    patChange === null ? 'Net profit comparison needs P&L data for both years.' : `Net profit ${patChange >= 0 ? 'grew' : 'declined'} ${Math.abs(patChange).toFixed(1)}% vs ${previous?.label}.`,
    current.patM === null ? 'Net margin will appear when P&L data is available.' : `Net margin stands at ${current.patM.toFixed(1)}%.`,
  ];
  return <ol className="space-y-2 p-3">{items.map((text, i) => <li key={text} className="flex gap-2 text-sm text-[#213b6a]"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-blue-600 text-xs font-bold text-white">{i + 1}</span>{text}</li>)}</ol>;
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className="min-w-0 overflow-hidden rounded-2xl border border-sky-100 bg-white/95 shadow-sm"><div className="flex items-center gap-2 px-4 pt-3 font-heading text-lg font-bold text-[#0b1b4d]"><span className="text-blue-600">{icon}</span>{title}</div>{children}</section>;
}

function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-8 text-center ${error ? 'border-rose-200 text-rose-600' : 'border-sky-200 text-slate-600'}`}>{children}</div>;
}

function money(value: number | null) { return value === null ? '—' : `₹${num(value)} Cr`; }
function num(value: number | null) { return value === null ? '—' : (value / CRORE).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(value / CRORE) >= 100 ? 0 : 2 }); }
function crValue(value: number) { return Number((value / CRORE).toFixed(2)); }
function crNullable(value: number | null) { return value === null ? null : crValue(value); }
function change(value: number | null, before: number | null) { return value === null || before === null || !before ? null : ((value - before) / Math.abs(before)) * 100; }
function growthText(value: number, before: number) { const g = change(value, before); return g === null ? 'cannot be compared with the prior year' : `${g >= 0 ? 'grew' : 'declined'} ${Math.abs(g).toFixed(1)}%`; }
function fcfChange(value: number | null, before: number | null) { const g = change(value, before); return g === null ? '—' : `${g >= 0 ? '▲ +' : '▼ '}${Math.abs(g).toFixed(1)}%`; }

function BarsIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="12" width="4" height="9" rx="1" /><rect x="10" y="7" width="4" height="14" rx="1" /><rect x="17" y="3" width="4" height="18" rx="1" /></svg>; }
function PieIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 3a9 9 0 1 0 10 10H11V3Z" /><path d="M13 3v8h8a9 9 0 0 0-8-8Z" opacity=".55" /></svg>; }
function DocIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 3h9l4 4v14H6zM14 3v5h5M9 12h7m-7 4h7" /></svg>; }
function PercentIcon() { return <span className="font-heading text-xl font-extrabold">%</span>; }
function CashIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 7h18v13H3zM3 7l3-4h12l3 4m-9 4v5m-2.5-2.5h5" /></svg>; }
function BulbIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M9 18h6m-5 3h4m-2-20a7 7 0 0 0-4 12.7c.6.4 1 1.1 1 1.8h6c0-.7.4-1.4 1-1.8A7 7 0 0 0 12 1Z" /></svg>; }
function TargetIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1" /></svg>; }
