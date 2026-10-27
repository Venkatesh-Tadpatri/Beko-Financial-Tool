import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { ApiError, peekReportCache } from '../api/client';
import { reportApi, type DashboardData, type DashboardYear } from '../api/data';
import { Chart } from '../components/Chart';
import { FyPicker, fyShort } from '../components/FyPicker';

// A 404 means the running backend predates this report (it was not restarted after an update).
const STALE = '__stale_backend__';

/* ------------------------------------------------------------------ palette */
const NAVY = '#0b1b4d';
const GRID = '#e8edf4';
const ACTUAL = '#1d6fe0';
const COMPARE = '#7fb2f0';
const UP = '#16a34a';
const DOWN = '#e11d48';
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
// Same palette and order as the Product Mix page, so a product keeps its colour across pages.
const PRODUCT_COLORS = ['#0752a4', '#08a68f', '#f8b700', '#349cf0', '#7829df', '#858585', '#ef6c35', '#d9468f', '#14b8a6'];
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const CRORE = 1_000_000_000;

const crNum = (paise: number) => paise / CRORE;
export function cr(paise: number) {
  const v = Math.abs(paise / CRORE);
  const digits = v >= 100 ? 0 : v >= 10 ? 1 : 2;
  return `${paise < 0 ? '−' : ''}${v.toLocaleString('en-IN', { maximumFractionDigits: digits })}`;
}
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const growth = (curr: number, prev: number) => (prev ? ((curr - prev) / Math.abs(prev)) * 100 : null);

/* ---------------------------------------------------------------- model */

interface Kpi {
  key: string;
  label: string;
  tone: Tone;
  icon: IconName;
  value: string | null; // null = source data not uploaded
  delta?: { text: string; good: boolean; up: boolean };
  vs?: string;
  missing?: string;
  spark: number[];
}

export function buildModel(d: DashboardData) {
  const fy = d.fy ?? 0;
  const cur = fyShort(fy);
  const prv = fyShort(fy - 1);
  const year = (y: number) => d.years.find((x) => x.fy === y);
  const thisYear = year(fy);
  const lastYear = year(fy - 1);

  // Months with sales this year; a part-year is compared with the same months last year.
  const monthsWithData = d.months.current.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const lastMonth = monthsWithData.length ? Math.max(...monthsWithData) : -1;
  const partial = lastMonth >= 0 && lastMonth < 11;
  const salesNow = d.months.current.reduce((a, v) => a + v, 0);
  const salesPrev = d.months.previous ? d.months.previous.slice(0, partial ? lastMonth + 1 : 12).reduce((a, v) => a + v, 0) : null;
  const salesGrowth = salesPrev ? growth(salesNow, salesPrev) : null;
  const span = partial ? `${MONTHS[0]}–${MONTHS[lastMonth]}` : '';

  const recent = d.years.filter((y) => y.fy <= fy).slice(-6);
  const series = (pick: (y: DashboardYear) => number | null) => recent.map(pick).filter((v): v is number => v !== null);

  const kpis: Kpi[] = [
    {
      key: 'sales', label: partial ? `Total Sales (${span})` : 'Total Sales', tone: 'blue', icon: 'bars',
      value: `₹${cr(salesNow)} Cr`,
      delta: salesGrowth !== null ? { text: signedPct(salesGrowth), good: salesGrowth >= 0, up: salesGrowth >= 0 } : undefined,
      vs: salesPrev ? `vs ${prv}${partial ? ' same months' : ''} (₹${cr(salesPrev)} Cr)` : `No ${prv} data to compare`,
      spark: series((y) => y.sales_paise),
    },
    metricKpi('fcf', 'Free Cash Flow', 'green', 'cash', thisYear?.free_cash_flow_paise ?? null, lastYear?.free_cash_flow_paise ?? null, prv,
      (v) => `₹${cr(v)} Cr`, 'pct', true, 'Upload Cash flow data to see free cash flow.', series((y) => y.free_cash_flow_paise)),
    metricKpi('dso', 'DSO (Receivable Days)', 'red', 'doc', thisYear?.dso_days ?? null, lastYear?.dso_days ?? null, prv,
      (v) => `${Math.round(v)} days`, 'days', false, 'Upload Receivables ageing data to see receivable days.', series((y) => y.dso_days)),
    metricKpi('roe', 'ROE', 'violet', 'target', thisYear?.roe_pct ?? null, lastYear?.roe_pct ?? null, prv,
      (v) => `${v.toFixed(1)}%`, 'pp', true, 'Upload Profit and loss and Balance sheet data to see ROE.', series((y) => y.roe_pct)),
  ];

  return { fy, cur, prv, partial, span, lastMonth, salesNow, salesPrev, salesGrowth, thisYear, lastYear, kpis };
}

function metricKpi(key: string, label: string, tone: Tone, icon: IconName, now: number | null, before: number | null, prv: string,
  show: (v: number) => string, mode: 'pct' | 'days' | 'pp', higherIsBetter: boolean, missing: string, spark: number[]): Kpi {
  if (now === null) return { key, label, tone, icon, value: null, missing, spark: [] };
  let delta: Kpi['delta'];
  if (before !== null) {
    const diff = now - before;
    const text = mode === 'pct' ? (growth(now, before) === null ? '' : signedPct(growth(now, before)!))
      : mode === 'days' ? `${diff >= 0 ? '+' : '−'}${Math.abs(Math.round(diff))} days`
      : `${diff >= 0 ? '+' : '−'}${Math.abs(diff).toFixed(1)} pp`;
    if (text) delta = { text, up: diff >= 0, good: higherIsBetter ? diff >= 0 : diff <= 0 };
  }
  return { key, label, tone, icon, value: show(now), delta, vs: before !== null ? `vs ${prv} (${show(before)})` : `No ${prv} data to compare`, spark };
}

/* ---------------------------------------------------------------- page */

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(() => peekReportCache('/api/reports/dashboard') ?? null);
  const [error, setError] = useState('');
  const [fy, setFy] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void reportApi.dashboard(fy).then((r) => live && setData(r)).catch((e: Error) => live && setError(e instanceof ApiError && e.status === 404 ? STALE : e.message));
    return () => { live = false; };
  }, [fy]);
  if (error) {
    const stale = error === STALE;
    return <Notice tone="error">{stale ? 'Executive Dashboard: the data service is out of date. Close the app completely and start it again.' : error}</Notice>;
  }
  if (!data) return null;
  if (data.fy === null) return <Notice>Executive Dashboard: no sales data is available yet. Upload and import a Sales Register file.</Notice>;
  return (
    <div>
      <DashboardView data={data} picker={<FyPicker fy={data.fy} years={data.available_fys} onChange={setFy} />} />
    </div>
  );
}

function Notice({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return <div className={`rounded-2xl border bg-white p-8 text-center ${tone === 'error' ? 'border-rose-200 text-rose-600' : 'border-sky-200 text-muted'}`}>{children}</div>;
}

export function DashboardView({ data, picker }: { data: DashboardData; picker?: ReactNode }) {
  const m = buildModel(data);
  const fcf = m.thisYear?.free_cash_flow_paise ?? null;
  const fcfPrev = m.lastYear?.free_cash_flow_paise ?? null;
  const dso = m.thisYear?.dso_days ?? null;
  const dsoPrev = m.lastYear?.dso_days ?? null;

  const g = m.salesGrowth;
  const growthWords = g === null ? `Sales of ₹${cr(m.salesNow)} Cr` : g >= 10 ? 'Strong growth' : g >= 0 ? 'Steady growth' : 'Sales below last year';
  const cashWords = fcf === null ? '' : fcf >= 0 ? ' and healthy cash position' : ' with cash under pressure';

  return (
    <div className="relative min-w-0 space-y-3">
      <Backdrop />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold uppercase tracking-[0.28em] text-[#0b1b4d]">Executive Dashboard</div>
          <h1 className="mt-1 font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d]">{growthWords}{cashWords}</h1>
        </div>
        {picker}
      </header>

      <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        {m.kpis.map((k) => <KpiCard key={k.key} kpi={k} />)}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <SalesTrend data={data} lastMonth={m.lastMonth} cur={m.cur} prv={m.prv} />
        <ProductShare data={data} cur={m.cur} prv={m.prv} partial={m.partial} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <YearBars title="Operating Profit (₹ Cr)" icon="bars" tone="blue" years={data.years} fy={m.fy} pick={(y) => y.operating_profit_paise}
          missing="Upload Profit and loss data (revenue, cost of goods sold, operating expenses) to see operating profit." />
        <YearBars title="Annual Sales (₹ Cr)" icon="doc" tone="green" years={data.years} fy={m.fy} pick={(y) => y.sales_paise}
          ytd={m.partial} headline={{ value: m.salesNow, prev: m.salesPrev, prvLabel: m.prv, sameMonths: m.partial }} />
        <Highlights data={data} model={m} />
      </div>
    </div>
  );
}

/** Soft waves, glow and rising bars behind the dashboard, as in the reference design. */
function Backdrop() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] w-full" viewBox="0 0 1600 420" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
      <defs>
        <radialGradient id="dash-glow" cx="78%" cy="10%" r="45%"><stop offset="0" stopColor="#c7dcff" stopOpacity=".9" /><stop offset="1" stopColor="#c7dcff" stopOpacity="0" /></radialGradient>
        <linearGradient id="dash-wave" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#dbe8ff" stopOpacity="0" /><stop offset=".6" stopColor="#cfe0ff" stopOpacity=".55" /><stop offset="1" stopColor="#b9d3ff" stopOpacity=".7" /></linearGradient>
        <linearGradient id="dash-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9cc3ff" stopOpacity=".55" /><stop offset="1" stopColor="#dbe8ff" stopOpacity="0" /></linearGradient>
      </defs>
      <rect width="1600" height="420" fill="url(#dash-glow)" />
      <path d="M0 210 C 300 150, 560 260, 900 190 S 1400 90, 1600 140 L1600 0 L0 0 Z" fill="url(#dash-wave)" opacity=".55" />
      <path d="M0 260 C 380 200, 640 300, 1000 230 S 1450 150, 1600 190" fill="none" stroke="#bcd4ff" strokeWidth="2" opacity=".6" />
      {[[1190, 120], [1230, 95], [1270, 105], [1310, 70], [1350, 80], [1390, 45], [1430, 55], [1470, 20]].map(([x, y]) => (
        <rect key={x} x={x} y={y} width="26" height={170 - y} rx="3" fill="url(#dash-bar)" />
      ))}
      <path d="M1180 140 C 1280 120, 1380 80, 1500 20" fill="none" stroke="#6ea5f7" strokeWidth="3" strokeLinecap="round" opacity=".55" />
      <path d="M1486 14 L1504 18 L1496 34" fill="none" stroke="#6ea5f7" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
    </svg>
  );
}

/* ---------------------------------------------------------------- KPI cards */

type Tone = 'blue' | 'green' | 'red' | 'violet' | 'orange';
const TONES: Record<Tone, { card: string; tile: string; icon: string; spark: [string, string] }> = {
  blue: { card: 'border-sky-300 from-sky-100 to-blue-50', tile: 'bg-gradient-to-br from-sky-400 to-blue-600 shadow-md', icon: 'text-white', spark: ['#bcd7fb', '#1d6fe0'] },
  green: { card: 'border-emerald-300 from-emerald-100 to-emerald-50', tile: 'bg-gradient-to-br from-emerald-400 to-emerald-600 shadow-md', icon: 'text-white', spark: ['#a8e6c9', '#10b27a'] },
  red: { card: 'border-rose-300 from-rose-100 to-rose-50', tile: 'bg-gradient-to-br from-rose-400 to-rose-600 shadow-md', icon: 'text-white', spark: ['#f6b3c0', '#f0607d'] },
  violet: { card: 'border-violet-300 from-violet-100 to-violet-50', tile: 'bg-gradient-to-br from-violet-400 to-violet-700 shadow-md', icon: 'text-white', spark: ['#d3c2fb', '#8b5cf6'] },
  orange: { card: 'border-orange-300 from-orange-100 to-amber-50', tile: 'bg-gradient-to-br from-amber-400 to-orange-600 shadow-md', icon: 'text-white', spark: ['#ffd0a3', '#f97316'] },
};

function KpiCard({ kpi }: { kpi: Kpi }) {
  const t = TONES[kpi.tone];
  return (
    <div className={`relative flex min-h-[150px] min-w-0 gap-4 overflow-hidden rounded-2xl border bg-gradient-to-br px-5 py-4 shadow-[0_4px_20px_rgba(15,40,90,0.06)] ${t.card}`}>
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full ${t.tile} ${t.icon}`}><Icon name={kpi.icon} size={28} /></span>
      <div className={`@container relative z-10 min-w-0 flex-1 ${kpi.spark.length > 1 ? 'sm:pr-16' : ''}`}>
        <div className="text-[15px] font-semibold leading-tight text-[#0b1b4d]">{kpi.label}</div>
        {kpi.value === null ? (
          <>
            <div className="mt-1 font-heading text-3xl font-extrabold text-[#94a3b8]">—</div>
            <div className="mt-1 text-sm text-[#475569]">{kpi.missing}</div>
          </>
        ) : (
          <>
            <div className="mt-0.5 whitespace-nowrap font-heading text-[clamp(18px,17cqi,32px)] font-extrabold leading-tight text-[#0b1b4d]">{kpi.value}</div>
            {kpi.delta && (
              <div className={`flex items-center gap-1 text-base font-bold ${kpi.delta.good ? 'text-emerald-600' : 'text-rose-600'}`}>
                <span className="text-sm">{kpi.delta.up ? '▲' : '▼'}</span>{kpi.delta.text}
              </div>
            )}
            {kpi.vs && <div className="text-sm text-[#334155]">{kpi.vs}</div>}
          </>
        )}
      </div>
      {kpi.spark.length > 1 && <div className="pointer-events-none absolute bottom-4 right-4 hidden opacity-70 sm:block"><SparkBars values={kpi.spark} colors={t.spark} /></div>}
    </div>
  );
}

function SparkBars({ values, colors }: { values: number[]; colors: [string, string] }) {
  const max = Math.max(...values.map(Math.abs), 1);
  return (
    <div className="pointer-events-none flex h-12 items-end gap-1" aria-hidden="true">
      {values.map((v, i) => (
        <span key={i} className="w-2.5 rounded-t-sm" style={{ height: `${Math.max(12, (Math.abs(v) / max) * 100)}%`, background: `linear-gradient(${colors[1]}, ${colors[0]})`, opacity: 0.35 + (0.65 * (i + 1)) / values.length }} />
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- panels */

function Panel({ title, icon, iconColor = '#1d6fe0', legend, children, className = '' }: { title: string; icon: IconName; iconColor?: string; legend?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_4px_20px_rgba(15,40,90,0.06)] backdrop-blur-sm ${className}`}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-heading text-xl font-bold text-[#0b1b4d]"><span style={{ color: iconColor }}><Icon name={icon} size={26} /></span>{title}</h2>
        {legend}
      </div>
      {children}
    </section>
  );
}

function SalesTrend({ data, lastMonth, cur, prv }: { data: DashboardData; lastMonth: number; cur: string; prv: string }) {
  const n = Math.max(lastMonth + 1, 1);
  const actual = data.months.current.slice(0, n).map(crNum);
  const usesForecast = !!data.months.forecast;
  const compareRaw = data.months.forecast ?? data.months.previous;
  const compare = compareRaw ? compareRaw.slice(0, n).map(crNum) : null;
  const variance = compare ? actual.map((a, i) => a - compare[i]) : null;
  const compareLabel = usesForecast ? 'Forecast' : `Last year (${prv})`;
  const fyOf = (i: number) => (data.fy ?? 0) + (i >= 9 ? 1 : 0);

  const option = useMemo<EChartsCoreOption>(() => {
    // Lines on top, variance bars in their own strip below (as in the reference),
    // so a large shortfall never squashes the trend lines.
    const top = Math.max(...actual, ...(compare ?? [0]), 0.01);
    const label = (v: number) => v.toLocaleString('en-IN', { maximumFractionDigits: v >= 100 ? 0 : 2 });
    const hasVar = !!variance;
    const grids = hasVar
      ? [{ left: 52, right: 16, top: 26, height: '56%' }, { left: 52, right: 16, bottom: 46, height: '20%' }]
      : [{ left: 52, right: 16, top: 26, bottom: 30 }];
    const months = MONTHS.slice(0, n);
    const series: unknown[] = [];
    if (compare) {
      series.push({
        // The higher of the two lines is labelled above, the lower one below, so labels never collide.
        name: compareLabel, type: 'line', data: compare.map((v, i) => ({ value: Number(v.toFixed(2)), label: { position: v > actual[i] ? 'top' : 'bottom' } })), z: 3, symbol: 'circle', symbolSize: 8,
        lineStyle: { color: COMPARE, width: 2, type: 'dashed' }, itemStyle: { color: '#fff', borderColor: COMPARE, borderWidth: 2 },
        label: { show: true, position: 'bottom', distance: 8, color: '#2b7bd9', fontWeight: 700, fontSize: 12, formatter: ({ value }: { value: number }) => label(value) },
        labelLayout: { hideOverlap: true },
      });
    }
    series.push({
      name: 'Actual', type: 'line', data: actual.map((v, i) => ({ value: Number(v.toFixed(2)), label: { position: compare && compare[i] > v ? 'bottom' : 'top' } })), z: 4, symbol: 'circle', symbolSize: 10,
      lineStyle: { color: ACTUAL, width: 3 }, itemStyle: { color: ACTUAL, borderColor: '#fff', borderWidth: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(29,111,224,0.12)' }, { offset: 1, color: 'rgba(29,111,224,0)' }] } },
      label: { show: true, position: 'top', distance: 8, color: NAVY, fontWeight: 800, fontSize: 13, formatter: ({ value }: { value: number }) => label(value) },
      labelLayout: { hideOverlap: true },
    });
    if (variance) {
      series.push({
        name: 'Variance', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barWidth: '46%',
        data: variance.map((v) => ({
          value: Number(v.toFixed(2)),
          itemStyle: { color: v >= 0 ? 'rgba(16,178,122,0.8)' : 'rgba(240,96,125,0.85)', borderRadius: v >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] },
          label: { color: v >= 0 ? UP : DOWN, position: v >= 0 ? 'top' : 'bottom' },
        })),
        label: { show: true, fontWeight: 800, fontSize: 12, formatter: ({ value }: { value: number }) => `${value >= 0 ? '+' : '−'}${label(Math.abs(value))}` },
      });
    }
    const varMax = variance ? Math.max(...variance.map(Math.abs), 0.01) : 1;
    return {
      textStyle: { fontFamily: FONT },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr` },
      axisPointer: { link: [{ xAxisIndex: 'all' }] },
      grid: grids,
      xAxis: [
        { type: 'category', gridIndex: 0, data: months, axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { show: !hasVar, color: NAVY, fontSize: 13 } },
        ...(hasVar ? [{
          type: 'category', gridIndex: 1, data: months, position: 'bottom', axisTick: { show: false }, axisLine: { onZero: true, lineStyle: { color: '#cbd5e1' } },
          axisLabel: {
            interval: 0, color: NAVY, fontSize: 13, lineHeight: 16, margin: 26,
            formatter: (m: string, i: number) => {
              if (!variance || !compare || !compare[i]) return m;
              const pc = (variance[i] / compare[i]) * 100;
              return `{${pc >= 0 ? 'up' : 'down'}|(${pc >= 0 ? '+' : '−'}${Math.abs(pc).toFixed(1)}%)}
${m}`;
            },
            rich: { up: { color: UP, fontWeight: 700, fontSize: n > 9 ? 10 : 12 }, down: { color: DOWN, fontWeight: 700, fontSize: n > 9 ? 10 : 12 } },
          },
        }] : []),
      ],
      yAxis: [
        { type: 'value', gridIndex: 0, min: 0, max: niceCeil(top * 1.2), splitNumber: 4, axisLabel: { color: NAVY }, axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, splitLine: { lineStyle: { color: GRID } } },
        ...(hasVar ? [{ type: 'value', gridIndex: 1, min: -varMax * 1.6, max: varMax * 1.6, axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false } }] : []),
      ],
      series,
    };
  }, [actual, compare, variance, compareLabel, n]);

  const legend = (
    <div className="flex flex-wrap items-center gap-5 text-sm text-[#0b1b4d]">
      <span className="flex items-center gap-2"><span className="h-3.5 w-3.5 rounded-full" style={{ background: ACTUAL }} />Actual</span>
      {compare && <span className="flex items-center gap-2"><span className="w-7 border-t-2 border-dashed" style={{ borderColor: COMPARE }} />{compareLabel}</span>}
      {variance && <span className="flex items-center gap-2"><span className="flex"><span className="h-3.5 w-3.5 bg-emerald-400" /><span className="h-3.5 w-3.5 bg-rose-400" /></span>Variance</span>}
    </div>
  );
  return (
    <Panel title="Sales Trend (₹ Cr)" icon="bars" legend={legend}>
      <div className="h-[340px]"><Chart key={data.fy} option={option} className="h-full w-full" /></div>
      <p className="mt-2 text-xs text-[#475569]">
        {cur} by month ({MONTHS[0]} {data.fy} – {MONTHS[n - 1]} {fyOf(n - 1)}).{' '}
        {usesForecast ? 'Variance is actual minus forecast.' : compare ? `No forecast uploaded, so each month is compared with the same month of ${prv}.` : `No ${prv} data to compare.`}
      </p>
    </Panel>
  );
}

function ProductShare({ data, cur, prv, partial }: { data: DashboardData; cur: string; prv: string; partial: boolean }) {
  // Every product with sales this year, largest first, compared with the same months of last year.
  const prevBase = data.products.previous_same_months ?? data.products.previous;
  const sameMonths = partial && !!data.products.previous_same_months;
  const lastMonth = data.months.current.reduce((a, v, i) => (v ? i : a), 0);
  const total = Object.values(data.products.current).reduce((a, v) => a + v, 0);
  const prevTotal = Object.values(prevBase).reduce((a, v) => a + v, 0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const rows = Object.entries(data.products.current)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value], i) => {
      const prev = prevBase[name] ?? 0;
      return {
        name, value, prev, color: PRODUCT_COLORS[i % PRODUCT_COLORS.length],
        share: total ? (value * 100) / total : 0,
        pp: prevTotal ? (value * 100) / total - (prev * 100) / prevTotal : null,
        change: prev ? ((value - prev) / prev) * 100 : null,
      };
    });

  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: FONT },
    tooltip: { show: false },
    series: [{
      type: 'pie', center: ['50%', '50%'], radius: ['48%', '86%'], startAngle: 90, minShowLabelAngle: 16,
      itemStyle: { borderColor: '#fff', borderWidth: 2, shadowBlur: 10, shadowColor: 'rgba(11, 27, 77, 0.25)', shadowOffsetY: 5 },
      label: { show: true, position: 'inside', color: '#fff', fontWeight: 800, fontSize: 13, formatter: ({ percent }: { percent: number }) => `${percent.toFixed(0)}%` },
      data: rows.map((r) => ({ name: r.name, value: r.value, itemStyle: { color: r.color } })),
    }],
  }), [rows]);

  const chartEvents = {
    mouseover: (params: { componentType?: string; seriesType?: string; dataIndex?: number }) => {
      if (params.componentType === 'series' && params.seriesType === 'pie' && typeof params.dataIndex === 'number') setHoveredIndex(params.dataIndex);
    },
    globalout: () => setHoveredIndex(null),
  };
  const hovered = hoveredIndex === null ? null : rows[hoveredIndex] ?? null;
  const hoverPoint = hovered && hoveredIndex !== null && total > 0
    ? (() => {
      const before = rows.slice(0, hoveredIndex).reduce((sum, row) => sum + row.value, 0);
      const angle = ((before + hovered.value / 2) / total) * Math.PI * 2;
      return { x: 50 + 40 * Math.sin(angle), y: 50 - 32 * Math.cos(angle) };
    })()
    : null;
  const calloutPosition = hoverPoint
    ? `${hoverPoint.y > 60 ? 'bottom-[8%]' : 'top-[8%]'} ${hoverPoint.x < 50 ? 'left-[2%]' : 'right-[2%]'}`
    : 'right-[2%] top-[8%]';

  return (
    <Panel title="Sales by Product, Share %" icon="pie">
      {/* Side by side only when this panel (not the window) is wide enough for both. */}
      <div className="@container">
      <div className="grid items-center gap-4 @min-[700px]:grid-cols-[280px_minmax(0,1fr)]">
        <div className="relative mx-auto h-[340px] w-full max-w-[380px] @min-[700px]:h-[360px]">
          <div className="absolute inset-0" style={{ transform: 'perspective(1100px) rotateX(38deg)', transformOrigin: 'center center', filter: 'drop-shadow(0 22px 0 rgba(5, 43, 103, 0.94)) drop-shadow(0 30px 14px rgba(11, 27, 77, 0.28))' }}>
            <Chart key={data.fy} option={option} onEvents={chartEvents} className="h-full w-full" />
          </div>
          {hovered && (
              <div className={`pointer-events-none absolute z-10 w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-[#0b1b4d] shadow-[0_8px_24px_rgba(15,23,42,0.2)] ${calloutPosition}`}>
                <div className="flex items-center gap-2 text-sm font-extrabold leading-tight"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: hovered.color }} /><span>{hovered.name}</span></div>
                <div className="mt-1 pl-[18px] text-base font-bold whitespace-nowrap">₹{cr(hovered.value)} Cr ({hovered.share.toFixed(1)}%)</div>
              </div>
          )}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center text-[#0b1b4d]">
              <div className="font-heading text-2xl font-extrabold">₹{cr(total)} Cr</div>
              <div className="text-sm leading-4">Total Sales<br />{cur}{partial ? ' (YTD)' : ''}</div>
            </div>
          </div>
        </div>
        <div className="min-w-0">
          {/* Fixed column widths keep the table inside the panel at any window size. */}
          <table className="w-full table-fixed text-sm text-[#0b1b4d]">
            <colgroup><col /><col className="w-[84px]" /><col className="w-[76px]" /><col className="w-[56px]" /></colgroup>
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[#64748b]">
                <th className="pb-2 font-semibold">Product</th>
                <th className="pb-2 text-right font-semibold">Sales</th>
                <th className="pb-2 text-right font-semibold">Share</th>
                <th className="pb-2 pl-3 text-center font-semibold" title={`Sales compared with ${prv}`}>vs {prv}{sameMonths ? '*' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = r.change === null ? 'new' : Math.abs(r.change) < 0.05 ? 'flat' : r.change > 0 ? 'up' : 'down';
                return (
                  <tr key={r.name} className="border-t border-slate-100">
                    <td className="py-1.5 pr-2">
                      <span className="flex items-center gap-2 font-medium"><span className="h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} /><span className="min-w-0 break-words leading-snug">{r.name}</span></span>
                    </td>
                    <td className="whitespace-nowrap py-1.5 text-right font-semibold tabular-nums">{r.value < CRORE / 100 ? '<₹0.01' : `₹${cr(r.value)}`} Cr</td>
                    <td className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums leading-tight">
                      <b>{r.share.toFixed(1)}%</b>
                      {r.pp !== null && Math.abs(r.pp) >= 0.05 && <div className={`text-xs ${r.pp > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{r.pp > 0 ? '+' : '−'}{Math.abs(r.pp).toFixed(1)} pp</div>}
                    </td>
                    <td className="py-1.5 pl-3 text-center">
                      {/* Icon only: green up / red down; the exact change is in the hover text. */}
                      {status === 'up' || status === 'down' ? (
                        <span role="img" aria-label={`${status === 'up' ? 'Increased' : 'Decreased'} ${signedPct(r.change ?? 0)} vs ${prv}`} title={`${status === 'up' ? 'Increased' : 'Decreased'} ${signedPct(r.change ?? 0)} vs ${prv}`}
                          className={`inline-grid h-7 w-7 place-items-center rounded-full ${status === 'up' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                          <Icon name={status === 'up' ? 'up' : 'down'} size={16} />
                        </span>
                      ) : (
                        <span title={status === 'new' ? `No sales in ${prv}` : 'No change'} className="inline-grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-slate-500">–</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {sameMonths && <p className="mt-2 text-xs text-[#64748b]">* Compared with the same months of {prv} ({MONTHS[0]}–{MONTHS[lastMonth]}).</p>}
        </div>
      </div>
      </div>
    </Panel>
  );
}

function YearBars({ title, icon, tone, years, fy, pick, missing, ytd = false, headline }: {
  title: string; icon: IconName; tone: 'blue' | 'green'; years: DashboardYear[]; fy: number;
  pick: (y: DashboardYear) => number | null; missing?: string; ytd?: boolean;
  headline?: { value: number; prev: number | null; prvLabel: string; sameMonths: boolean };
}) {
  const shown = years.filter((y) => y.fy <= fy && pick(y) !== null).slice(-5);
  const colors = tone === 'blue' ? ['#9cc8f7', '#1559d6'] : ['#a9e5c8', '#0e9f6e'];
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: FONT },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr` },
    grid: { left: 8, right: 8, top: 28, bottom: ytd ? 40 : 28 },
    xAxis: { type: 'category', data: shown.map((y) => `${fyShort(y.fy)}${ytd && y.fy === fy ? '\n(YTD)' : ''}`), axisTick: { show: false }, axisLine: { lineStyle: { color: '#cbd5e1' } }, axisLabel: { interval: 0, color: NAVY, fontSize: 13, fontWeight: 600, lineHeight: 15 } },
    yAxis: { type: 'value', show: false },
    series: [{
      type: 'bar', barWidth: '72%',
      data: shown.map((y, i) => {
        const t = shown.length > 1 ? i / (shown.length - 1) : 1;
        const c = mix(colors[0], colors[1], t);
        return { value: Number(crNum(pick(y) ?? 0).toFixed(2)), itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c }, { offset: 1, color: mix(colors[0], colors[1], Math.min(1, t + 0.15)) }] }, borderRadius: [3, 3, 0, 0] } };
      }),
      label: { show: true, position: 'top', color: NAVY, fontWeight: 800, fontSize: 13, formatter: ({ value }: { value: number }) => `₹${value.toLocaleString('en-IN', { maximumFractionDigits: value >= 100 ? 0 : 2 })} Cr` },
    }],
  }), [shown, colors, ytd, fy, pick]);

  const latest = shown.find((y) => y.fy === fy);
  const before = shown.find((y) => y.fy === fy - 1);
  const value = headline ? headline.value : latest ? pick(latest) : null;
  const prev = headline ? headline.prev : before ? pick(before) : null;
  const g = value !== null && prev ? growth(value, prev) : null;
  return (
    <Panel title={title} icon={icon} iconColor={tone === 'blue' ? '#1d6fe0' : '#0e9f6e'}>
      {shown.length === 0 ? (
        <div className="grid h-[290px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-6 text-center text-sm text-[#475569]">{missing}</div>
      ) : (
        <>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-1">
            <div className="font-heading text-4xl font-extrabold text-[#0b1b4d]">{value === null ? '—' : `₹${cr(value)} Cr`}</div>
            {g !== null && (
              <div>
                <div className={`flex items-center gap-1 text-xl font-bold ${g >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}><span className="text-sm">{g >= 0 ? '▲' : '▼'}</span>{signedPct(g)}</div>
                <div className="text-sm text-[#334155]">vs {headline?.prvLabel ?? fyShort(fy - 1)}{headline?.sameMonths ? ' same months' : ''} (₹{cr(prev ?? 0)} Cr)</div>
              </div>
            )}
          </div>
          <div className="h-[220px]"><Chart key={fy} option={option} className="h-full w-full" /></div>
        </>
      )}
    </Panel>
  );
}

function Highlights({ data, model }: { data: DashboardData; model: ReturnType<typeof buildModel> }) {
  const items: { tone: Tone; icon: IconName; title: string; body: string }[] = [];
  const { salesGrowth: g, salesNow, salesPrev, thisYear: t, lastYear: l, cur, prv, partial, span } = model;
  if (g !== null && salesPrev !== null) {
    items.push({ tone: g >= 0 ? 'green' : 'red', icon: g >= 0 ? 'up' : 'down', title: g >= 0 ? 'Revenue Growth' : 'Revenue Decline',
      body: `Total sales ${g >= 0 ? 'increased' : 'decreased'} by ${Math.abs(g).toFixed(1)}% from ₹${cr(salesPrev)} Cr to ₹${cr(salesNow)} Cr${partial ? ` (${span})` : ''}.` });
  }
  if (t?.free_cash_flow_paise != null) {
    items.push({ tone: 'blue', icon: 'trophy', title: t.free_cash_flow_paise >= 0 ? 'Strong Cash Flow' : 'Cash Flow',
      body: `Free cash flow ${l?.free_cash_flow_paise != null ? `${t.free_cash_flow_paise >= l.free_cash_flow_paise ? 'rose' : 'fell'} to` : 'is'} ₹${cr(t.free_cash_flow_paise)} Cr${l?.free_cash_flow_paise != null ? ` (vs ₹${cr(l.free_cash_flow_paise)} Cr in ${prv})` : ''}.` });
  }
  if (t?.dso_days != null) {
    const d = l?.dso_days != null ? Math.round(l.dso_days - t.dso_days) : null;
    items.push({ tone: 'violet', icon: 'stack', title: d !== null && d >= 0 ? 'Improved Receivables' : 'Receivables',
      body: d === null ? `DSO is ${Math.round(t.dso_days)} days.` : `DSO ${d >= 0 ? 'reduced' : 'increased'} by ${Math.abs(d)} days to ${Math.round(t.dso_days)} days (vs ${prv}).` });
  }
  if (t?.roe_pct != null) {
    const d = l?.roe_pct != null ? t.roe_pct - l.roe_pct : null;
    items.push({ tone: 'orange', icon: 'bars', title: d !== null && d >= 0 ? 'Higher Returns' : 'Returns',
      body: `ROE is ${t.roe_pct.toFixed(1)}%${d !== null ? `, ${d >= 0 ? 'up' : 'down'} ${Math.abs(d).toFixed(1)} percentage points from ${prv}` : ''}.` });
  }
  // Fill the panel from sales data when finance uploads are missing.
  const ranked = Object.entries(data.products.current).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((a, [, v]) => a + v, 0);
  if (items.length < 4 && ranked.length) items.push({ tone: 'blue', icon: 'trophy', title: 'Top Product', body: `${ranked[0][0]} leads with ${((ranked[0][1] * 100) / total).toFixed(1)}% of ${cur} sales (₹${cr(ranked[0][1])} Cr).` });
  const best = data.months.current.reduce((b, v, i) => (v > data.months.current[b] ? i : b), 0);
  if (items.length < 4 && data.months.current[best] > 0) {
    const year = (data.fy ?? 0) + (best >= 9 ? 1 : 0);
    items.push({ tone: 'violet', icon: 'stack', title: 'Best Month', body: `${MONTHS[best]} ${year} was the strongest month at ₹${cr(data.months.current[best])} Cr.` });
  }
  if (items.length < 4 && ranked.length > 1) {
    const top2 = ((ranked[0][1] + ranked[1][1]) * 100) / total;
    items.push({ tone: 'orange', icon: 'bars', title: 'Sales Concentration', body: `${ranked[0][0]} and ${ranked[1][0]} together make up ${top2.toFixed(1)}% of sales.` });
  }

  const ROW: Record<Tone, { bg: string; tile: string; title: string }> = {
    green: { bg: 'bg-[#eaf7f1]', tile: 'bg-[#10b27a]', title: 'text-[#0b1b4d]' },
    blue: { bg: 'bg-[#edf4ff]', tile: 'bg-[#1d6fe0]', title: 'text-[#0b1b4d]' },
    violet: { bg: 'bg-[#f3eeff]', tile: 'bg-[#7c3aed]', title: 'text-[#7c3aed]' },
    orange: { bg: 'bg-[#fff2e8]', tile: 'bg-[#f97316]', title: 'text-[#ea580c]' },
    red: { bg: 'bg-[#fdecef]', tile: 'bg-[#e11d48]', title: 'text-[#e11d48]' },
  };
  return (
    <Panel title="Key Highlights" icon="bulb" iconColor="#1d6fe0">
      <div className="space-y-2.5">
        {items.slice(0, 4).map((it) => {
          const r = ROW[it.tone];
          return (
            <div key={it.title} className={`flex items-center gap-4 rounded-xl px-3 py-2.5 ${r.bg}`}>
              <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-white shadow-sm ring-4 ring-white/70 ${r.tile}`}><Icon name={it.icon} size={24} /></span>
              <div className="min-w-0">
                <div className={`font-heading text-base font-bold ${r.title}`}>{it.title}</div>
                <div className="text-sm text-[#334155]">{it.body}</div>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- helpers */

function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => Math.ceil(v / x) <= 6) ?? p * 10;
  return Number((Math.ceil(v / step) * step).toFixed(4));
}

function mix(a: string, b: string, t: number) {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function escapeTooltipText(value: string) {
  const entities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
}

type IconName = 'bars' | 'cash' | 'doc' | 'target' | 'pie' | 'up' | 'down' | 'trophy' | 'stack' | 'bulb';
function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'bars': return <svg {...p} strokeWidth={3}><path d="M5 20v-6M10 20V10M15 20V7M20 20V4" /></svg>;
    case 'cash': return <svg {...p}><path d="M9 3h6l-1.6 3.2h-2.8L9 3Z" /><path d="M10.6 6.2C6.6 8.2 4.5 12 4.5 15a5 5 0 0 0 5 5h5a5 5 0 0 0 5-5c0-3-2.1-6.8-6.1-8.8" /><path d="M10 11.5h4m-4 2.2h4m-2.6 0 2.8 3m-4.2-5.2c2.6 0 2.6 2.2 0 2.2" /></svg>;
    case 'doc': return <svg {...p}><path d="M7 3h7l4 4v14H7V3Z" /><path d="M14 3v4h4" /><path d="M10 11h5m-5 2.4h5m-2.6 0 2.6 3.6m-4.1-6c2.8 0 2.8 2.4 0 2.4" /></svg>;
    case 'target': return <svg {...p}><circle cx="11" cy="13" r="8" /><circle cx="11" cy="13" r="4.5" /><circle cx="11" cy="13" r="1.4" fill="currentColor" /><path d="m11 13 9-9m0 0h-4m4 0v4" /></svg>;
    case 'pie': return <svg {...p} fill="currentColor" stroke="none"><path d="M11 3.05A9 9 0 1 0 20.95 13H11V3.05Z" /><path d="M13 3.05V11h7.95A9 9 0 0 0 13 3.05Z" opacity=".55" /></svg>;
    case 'up': return <svg {...p} strokeWidth={2.6}><path d="M12 19V5m0 0-6 6m6-6 6 6" /></svg>;
    case 'down': return <svg {...p} strokeWidth={2.6}><path d="M12 5v14m0 0-6-6m6 6 6-6" /></svg>;
    case 'trophy': return <svg {...p}><path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" fill="currentColor" /><path d="M8 6H5a3 3 0 0 0 3 4m8-4h3a3 3 0 0 1-3 4M12 13v4m-4 3h8m-6-3h4" /></svg>;
    case 'stack': return <svg {...p}><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" /></svg>;
    case 'bulb': return <svg {...p}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.6.5.9 1.1.9 1.9V16h5.4v-.3c0-.8.3-1.4.9-1.9A6 6 0 0 0 12 3Z" fill="currentColor" opacity=".9" /><path d="M12 0.5v1.5M4 4l1 1M20 4l-1 1M2 11h1.5M20.5 11H22" stroke="#f59e0b" /></svg>;
  }
}

/* The reference design's figures, used by tests and design checks. */
const c = (v: number) => v * CRORE;
export const SAMPLE_DASHBOARD: DashboardData = {
  fy: 2024,
  available_fys: [2020, 2021, 2022, 2023, 2024],
  years: [
    { fy: 2020, sales_paise: c(310), operating_profit_paise: c(52), free_cash_flow_paise: c(40), roe_pct: 15, dso_days: 52 },
    { fy: 2021, sales_paise: c(420), operating_profit_paise: c(64), free_cash_flow_paise: c(50), roe_pct: 16.5, dso_days: 50 },
    { fy: 2022, sales_paise: c(460), operating_profit_paise: c(72), free_cash_flow_paise: c(60), roe_pct: 18, dso_days: 47 },
    { fy: 2023, sales_paise: c(443), operating_profit_paise: c(78), free_cash_flow_paise: c(70), roe_pct: 19, dso_days: 45 },
    { fy: 2024, sales_paise: c(517), operating_profit_paise: c(92), free_cash_flow_paise: c(140), roe_pct: 25, dso_days: 42 },
  ],
  months: {
    current: [40, 41, 42, 43, 44, 42, 43, 44, 46, 44, 44, 44].map(c),
    previous: [36, 36, 37, 37, 37, 36, 37, 38, 38, 37, 37, 37].map(c),
    forecast: null,
  },
  products: {
    current: { 'Product A': c(181), 'Product B': c(129), 'Product C': c(103), 'Product D': c(62), Others: c(42) },
    previous: { 'Product A': c(133), 'Product B': c(98), 'Product C': c(98), 'Product D': c(53), Others: c(40) },
  },
};
