import { useEffect, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { ApiError, peekReportCache } from '../api/client';
import { reportApi, type ForecastYear } from '../api/data';
import { Chart } from '../components/Chart';
import { FyPicker, fyShort } from '../components/FyPicker';

/* ------------------------------------------------------------------ palette */
const NAVY = '#0b1b4d';
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
const MINT = { top: '#c7eedd', bottom: '#8fd6b8' };
const BLUE = { top: '#3ea2ff', bottom: '#1559d6' };
const ORANGE = '#f59e0b';
const UP = '#15803d';
const DOWN = '#e11d48';
const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
const CRORE = 1_000_000_000;
const STALE = '__stale_backend__';

export type PeriodKey = 'H1' | 'H2' | 'FY' | 'Q1' | 'Q2' | 'Q3' | 'Q4';
export const PERIODS: Record<PeriodKey, { label: string; months: number[] }> = {
  H1: { label: 'H1', months: [0, 1, 2, 3, 4, 5] },
  H2: { label: 'H2', months: [6, 7, 8, 9, 10, 11] },
  Q1: { label: 'Q1', months: [0, 1, 2] },
  Q2: { label: 'Q2', months: [3, 4, 5] },
  Q3: { label: 'Q3', months: [6, 7, 8] },
  Q4: { label: 'Q4', months: [9, 10, 11] },
  FY: { label: 'Full year', months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

const cr = (paise: number) => {
  const v = Math.abs(paise / CRORE);
  return `${paise < 0 ? '−' : ''}₹${v.toLocaleString('en-IN', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 })} Cr`;
};
const signedCr = (paise: number) => `${paise >= 0 ? '+' : '−'}${cr(Math.abs(paise))}`;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

/* -------------------------------------------------------------------- model */

export interface MonthRow { m: number; label: string; forecast: number | null; actual: number | null; variance: number | null; pct: number | null }

export function buildRows(y: ForecastYear, period: PeriodKey): MonthRow[] {
  return PERIODS[period].months
    .map((m) => {
      const f = y.forecast && y.forecast[m] ? y.forecast[m] : null;
      const a = y.actual[m] ? y.actual[m] : null;
      const variance = f !== null && a !== null ? a - f : null;
      return { m, label: MONTHS[m], forecast: f, actual: a, variance, pct: variance !== null && f ? (variance / f) * 100 : null };
    })
    .filter((r) => r.forecast !== null || r.actual !== null);
}

/** Default period: the latest half (or full year) whose months all have actuals; otherwise the full year. */
function defaultPeriod(y: ForecastYear | undefined): PeriodKey {
  if (!y) return 'FY';
  const full = (ms: number[]) => ms.every((m) => y.actual[m]);
  if (full(PERIODS.FY.months)) return 'FY';
  if (full(PERIODS.H1.months)) return 'H1';
  return 'FY';
}

/* ---------------------------------------------------------------- page */

export function ForecastPage() {
  const [years, setYears] = useState<ForecastYear[] | null>(() => peekReportCache<{ has_forecast: boolean; years: ForecastYear[] }>('/api/reports/forecast-vs-actual')?.years ?? null);
  const [error, setError] = useState('');
  useEffect(() => {
    void reportApi.forecastVsActual().then((r) => setYears(r.years)).catch((e: Error) => setError(e instanceof ApiError && e.status === 404 ? STALE : e.message));
  }, []);
  if (error) return <Notice tone="error">{error === STALE ? 'Actual vs Forecast: the data service is out of date. Close the app completely and start it again.' : error}</Notice>;
  if (!years) return null;
  if (!years.length) return <Notice>Actual vs Forecast: no sales or forecast data is available yet.</Notice>;
  return <ForecastScreen years={years} />;
}

function Notice({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return <div className={`rounded-2xl border bg-white p-8 text-center ${tone === 'error' ? 'border-rose-200 text-rose-600' : 'border-sky-200 text-muted'}`}>{children}</div>;
}

function ForecastScreen({ years }: { years: ForecastYear[] }) {
  // Open on the latest year that has a forecast (or the latest year when none has).
  const initial = [...years].reverse().find((y) => y.forecast) ?? years[years.length - 1];
  const [fy, setFy] = useState(initial.fy);
  const [period, setPeriod] = useState<PeriodKey>(() => defaultPeriod(initial));
  const year = years.find((y) => y.fy === fy) ?? initial;
  return (
    <ForecastView year={year} period={period}
      controls={
        <div className="flex flex-wrap items-center gap-3">
          <FyPicker fy={fy} years={years.map((y) => y.fy)} onChange={(v) => { setFy(v); setPeriod(defaultPeriod(years.find((y) => y.fy === v))); }} />
          <div role="tablist" aria-label="Period" className="flex flex-wrap gap-1 rounded-2xl bg-white/90 p-1.5 shadow-sm">
            {(Object.keys(PERIODS) as PeriodKey[]).map((k) => (
              <button key={k} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)}
                className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${period === k ? 'bg-[#0b2a6b] text-white' : 'text-[#0b1b4d] hover:bg-slate-100'}`}>
                {PERIODS[k].label}
              </button>
            ))}
          </div>
        </div>
      } />
  );
}

export function ForecastView({ year, period, controls }: { year: ForecastYear; period: PeriodKey; controls?: ReactNode }) {
  const rows = buildRows(year, period);
  const compared = rows.filter((r) => r.variance !== null);
  const fTotal = compared.reduce((a, r) => a + (r.forecast ?? 0), 0);
  const aTotal = compared.reduce((a, r) => a + (r.actual ?? 0), 0);
  const variance = aTotal - fTotal;
  const vPct = fTotal ? (variance / fTotal) * 100 : null;
  const above = compared.filter((r) => (r.variance ?? 0) >= 0);
  const below = compared.filter((r) => (r.variance ?? 0) < 0);
  const name = `${period === 'FY' ? '' : `${PERIODS[period].label} `}${fyShort(year.fy)}`;
  const hasForecast = !!year.forecast && rows.some((r) => r.forecast !== null);
  
  return (
    <div className="relative min-w-0 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold uppercase tracking-[0.16em] text-[#0e8a64]">Revenue <span className="mx-2 text-[#94a3b8]">|</span> Forecast vs Actual</div>
          <h1 className="mt-1 font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d]">
            {vPct === null ? <>{name} actual revenue {cr(rows.reduce((a, r) => a + (r.actual ?? 0), 0))}</>
              : variance >= 0 ? <>{name} beat forecast by <span className="text-[#0e9a6e]">{Math.abs(vPct).toFixed(1)}%</span></>
              : <>{name} missed forecast by <span className="text-rose-600">{Math.abs(vPct).toFixed(1)}%</span></>}
          </h1>
        </div>
        {controls}
      </header>

      {!hasForecast && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[15px] text-amber-900">
          <b>No revenue forecast has been uploaded for {fyShort(year.fy)} yet</b>, so only actual revenue is shown. To compare, go to <b>Upload data</b>, choose
          <b> Forecast</b> as the data type and upload an Excel file with the columns <b>Financial year</b> (e.g. {year.fy}), <b>Period</b> (month 1 = Apr … 12 = Mar)
          and <b>Revenue forecast</b> (₹).
        </div>
      )}

      {/* Summary cards on top, in one row on wide screens. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <SideCard tone="green" icon={<BarsIcon size={30} />} label={`${name} Actual Revenue`} value={cr(aTotal || rows.reduce((a, r) => a + (r.actual ?? 0), 0))} />
        <SideCard tone="blue" icon={<BarsIcon size={30} />} label={`${name} Forecast Revenue`} value={hasForecast ? cr(fTotal) : '—'} />
        <SideCard tone={vPct === null || variance >= 0 ? 'green' : 'red'} icon={<ArrowIcon up={vPct === null || variance >= 0} />} label="Variance (Actual vs Forecast)"
          value={vPct === null ? '—' : `${signedCr(variance)}  (${pct(vPct)})`} />
        <SideCard tone="violet" icon={<TargetIcon />} label="Months Above Forecast" value={compared.length ? `${above.length} / ${compared.length}` : '—'}
          aside={compared.length > 0 && <MiniBars rows={compared} />} />
        <SideCard tone="red" icon={<ArrowIcon up={false} />} label="Months Below Forecast" value={compared.length ? `${below.length} / ${compared.length}` : '—'}
          aside={below.length > 0 && <span className="text-sm font-semibold text-[#e11d48]">{below.slice(0, 3).map((r) => `${r.label} (${pct(r.pct ?? 0)})`).join(', ')}{below.length > 3 ? '…' : ''}</span>} />
      </div>

      <Panel title={`Monthly Revenue: Actual vs Forecast (₹ Cr)`} legend={<Legend />}>
        <div className="h-[340px]"><Chart key={`${year.fy}-${period}`} option={chartOption(rows)} className="h-full w-full" /></div>
      </Panel>
      <Panel title="Month-wise Revenue Details (₹ Cr)">
        <DetailsTable rows={rows} fTotal={fTotal} aTotal={aTotal} variance={variance} vPct={vPct} periodLabel={period === 'FY' ? 'Full year' : PERIODS[period].label} />
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- chart */

function chartOption(rows: MonthRow[]): EChartsCoreOption {
  const val = (p: number | null) => (p === null ? null : Number((p / CRORE).toFixed(2)));
  const top = Math.max(...rows.map((r) => Math.max(r.forecast ?? 0, r.actual ?? 0)), 1) / CRORE;
  const fmt = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 })} Cr`;
  const barLabel = (color: string) => ({ show: true, position: 'top', color, fontWeight: 800, fontSize: 12, formatter: ({ value }: { value: number | null }) => (value ? fmt(value) : '') });
  return {
    textStyle: { fontFamily: FONT },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number | null) => (v === null || v === undefined ? 'No data' : fmt(v)) },
    grid: { left: 56, right: 16, top: 70, bottom: 30 },
    xAxis: { type: 'category', data: rows.map((r) => r.label), axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 13, fontWeight: 600 } },
    yAxis: { type: 'value', min: 0, max: niceCeil(top * 1.3), name: 'Revenue (₹ Cr)', nameLocation: 'middle', nameGap: 42, nameTextStyle: { color: NAVY, fontWeight: 700 }, axisLabel: { color: NAVY }, axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, splitLine: { lineStyle: { color: '#e8edf4' } } },
    series: [
      { name: 'Forecast', type: 'bar', barGap: '6%', barWidth: rows.length > 6 ? '30%' : '32%', data: rows.map((r) => val(r.forecast)), itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: MINT.top }, { offset: 1, color: MINT.bottom }] }, borderRadius: [3, 3, 0, 0] }, label: rows.length > 6 ? { show: false } : barLabel('#334155') },
      { name: 'Actual', type: 'bar', barWidth: rows.length > 6 ? '30%' : '32%', data: rows.map((r) => val(r.actual)), itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: BLUE.top }, { offset: 1, color: BLUE.bottom }] }, borderRadius: [3, 3, 0, 0] }, label: barLabel('#1d4ed8') },
      { name: 'Forecast Trend', type: 'line', data: rows.map((r) => val(r.forecast)), symbol: 'circle', symbolSize: 7, lineStyle: { color: ORANGE, width: 2, type: 'dashed' }, itemStyle: { color: ORANGE }, z: 5, tooltip: { show: false } },
      { name: 'Actual Trend', type: 'line', data: rows.map((r) => val(r.actual)), symbol: 'circle', symbolSize: 7, lineStyle: { color: '#1d4ed8', width: 2 }, itemStyle: { color: '#1d4ed8' }, z: 6, tooltip: { show: false } },
      // Variance badge above each month's pair of bars.
      {
        name: 'Variance', type: 'scatter', symbolSize: 0, silent: true, z: 10, tooltip: { show: false },
        data: rows.map((r) => (r.variance === null ? null : { value: Math.max(r.forecast ?? 0, r.actual ?? 0) / CRORE, variance: r.variance, pct: r.pct })),
        label: {
          show: true, position: 'top', distance: 28, align: 'center', lineHeight: 15, padding: [5, 9], borderRadius: 8, borderWidth: 1,
          formatter: (p: { data: { variance: number; pct: number } | null }) => (p.data ? `{p|${pct(p.data.pct)}}\n{v|(${signedCr(p.data.variance).replace(' Cr', ' Cr')})}` : ''),
          rich: { p: { fontWeight: 800, fontSize: 13 }, v: { fontSize: 11 } },
        },
        // Colour each badge by sign.
        labelLayout: { hideOverlap: false },
      },
    ].map((s) => (s.name === 'Variance' ? colourBadges(s as Record<string, unknown>, rows) : s)),
  };
}

function niceCeil(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => Math.ceil(v / x) <= 8) ?? p * 10;
  return Number((Math.ceil(v / step) * step).toFixed(4));
}

function colourBadges(series: Record<string, unknown>, rows: MonthRow[]) {
  const base = series.label as Record<string, unknown>;
  return {
    ...series,
    data: rows.map((r) => {
      if (r.variance === null) return null;
      const up = r.variance >= 0;
      const c = up ? { bg: '#e3f7ec', border: '#86e0b0', text: UP } : { bg: '#ffe4e8', border: '#fda4b4', text: DOWN };
      return {
        value: Math.max(r.forecast ?? 0, r.actual ?? 0) / CRORE, variance: r.variance, pct: r.pct,
        label: { ...base, backgroundColor: c.bg, borderColor: c.border, rich: { p: { fontWeight: 800, fontSize: 13, color: c.text }, v: { fontSize: 11, color: c.text } } },
      };
    }),
  };
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm text-[#0b1b4d]">
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-4 rounded-sm" style={{ background: `linear-gradient(${MINT.top}, ${MINT.bottom})` }} />Forecast (₹ Cr)</span>
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-4 rounded-sm" style={{ background: `linear-gradient(${BLUE.top}, ${BLUE.bottom})` }} />Actual (₹ Cr)</span>
      <span className="flex items-center gap-1.5"><span className="w-6 border-t-2 border-dashed" style={{ borderColor: ORANGE }} />Forecast Trend</span>
      <span className="flex items-center gap-1.5"><span className="w-6 border-t-2 border-[#1d4ed8]" />Actual Trend</span>
    </div>
  );
}

/* ---------------------------------------------------------------- table + cards */

function DetailsTable({ rows, fTotal, aTotal, variance, vPct, periodLabel }: { rows: MonthRow[]; fTotal: number; aTotal: number; variance: number; vPct: number | null; periodLabel: string }) {
  const tone = (v: number | null) => (v === null ? 'text-slate-400' : v >= 0 ? 'text-emerald-600' : 'text-rose-600');
  const status = (v: number | null) => (v === null
    ? <span className="text-slate-400">No forecast</span>
    : <span className={`inline-flex items-center gap-2 font-semibold ${v >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}><span className={`h-3 w-3 rounded-full ${v >= 0 ? 'bg-emerald-500' : 'bg-rose-500'}`} />{v >= 0 ? 'Above' : 'Below'}</span>);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full min-w-[640px] border-collapse text-center text-sm text-[#0b1b4d]">
        <thead>
          <tr className="text-[13px] font-semibold leading-tight text-white">
            <th className="bg-[#0b2a6b] px-3 py-2">Month</th>
            <th className="bg-[#14a3a3] px-3 py-2">Forecast<br />(₹ Cr)</th>
            <th className="bg-[#1d6fe0] px-3 py-2">Actual<br />(₹ Cr)</th>
            <th className="bg-[#f58a1f] px-3 py-2">Variance<br />(₹ Cr)</th>
            <th className="bg-[#8b5cf6] px-3 py-2">Variance<br />(%)</th>
            <th className="bg-[#0b2a6b] px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.m} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]">
              <td className="px-3 py-1.5 font-semibold">{r.label}</td>
              <td className="px-3 py-1.5 tabular-nums">{r.forecast === null ? '–' : cr(r.forecast)}</td>
              <td className="px-3 py-1.5 tabular-nums">{r.actual === null ? '–' : cr(r.actual)}</td>
              <td className={`px-3 py-1.5 font-semibold tabular-nums ${tone(r.variance)}`}>{r.variance === null ? '–' : signedCr(r.variance)}</td>
              <td className={`px-3 py-1.5 font-semibold tabular-nums ${tone(r.pct)}`}>{r.pct === null ? '–' : pct(r.pct)}</td>
              <td className="px-3 py-1.5">{status(r.variance)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-emerald-200 bg-[#dcf5ea] text-[15px] font-extrabold">
            <td className="px-3 py-2">Total ({periodLabel})</td>
            <td className="px-3 py-2 tabular-nums">{vPct === null ? '–' : cr(fTotal)}</td>
            <td className="px-3 py-2 tabular-nums">{vPct === null ? '–' : cr(aTotal)}</td>
            <td className={`px-3 py-2 tabular-nums ${tone(vPct === null ? null : variance)}`}>{vPct === null ? '–' : signedCr(variance)}</td>
            <td className={`px-3 py-2 tabular-nums ${tone(vPct)}`}>{vPct === null ? '–' : pct(vPct)}</td>
            <td className="px-3 py-2">{status(vPct === null ? null : variance)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const SIDE = {
  green: { card: 'border-emerald-300 from-emerald-100 to-emerald-50', tile: 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md', label: 'text-[#0b1b4d]', value: 'text-[#0b1b4d]' },
  blue: { card: 'border-sky-300 from-sky-100 to-blue-50', tile: 'bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-md', label: 'text-[#1d4ed8]', value: 'text-[#0b1b4d]' },
  violet: { card: 'border-violet-300 from-violet-100 to-violet-50', tile: 'bg-gradient-to-br from-violet-400 to-violet-700 text-white shadow-md', label: 'text-[#6d28d9]', value: 'text-[#4c1d95]' },
  red: { card: 'border-rose-300 from-rose-100 to-rose-50', tile: 'bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-md', label: 'text-[#e11d48]', value: 'text-[#be123c]' },
};

function SideCard({ tone, icon, label, value, aside }: { tone: keyof typeof SIDE; icon: ReactNode; label: string; value: string; aside?: ReactNode }) {
  const t = SIDE[tone];
  return (
    <div className={`flex min-h-[96px] min-w-0 items-center gap-3 rounded-2xl border bg-gradient-to-br px-4 py-3 shadow-sm ${t.card}`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${t.tile} [&>svg]:h-6 [&>svg]:w-6`}>{icon}</span>
      <div className="@container min-w-0 flex-1">
        <div className={`text-sm font-bold ${t.label}`}>{label}</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <div className={`whitespace-nowrap font-heading text-[clamp(16px,13cqi,28px)] font-extrabold leading-tight ${t.value}`}>{value}</div>
          {aside}
        </div>
      </div>
    </div>
  );
}

function MiniBars({ rows }: { rows: MonthRow[] }) {
  const max = Math.max(...rows.map((r) => r.actual ?? 0), 1);
  return (
    <div className="flex h-9 items-end gap-1" aria-hidden="true">
      {rows.map((r) => <span key={r.m} className={`w-2.5 rounded-t-sm ${(r.variance ?? 0) >= 0 ? 'bg-emerald-400' : 'bg-rose-400'}`} style={{ height: `${Math.max(25, ((r.actual ?? 0) / max) * 100)}%` }} />)}
    </div>
  );
}

function Panel({ title, legend, children }: { title: string; legend?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_4px_20px_rgba(15,40,90,0.06)]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-heading text-xl font-bold text-[#0b1b4d]"><span className="text-[#1d6fe0]"><BarsIcon /></span>{title}</h2>
        {legend}
      </div>
      {children}
    </section>
  );
}

function BarsIcon({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="12" width="4.5" height="9" rx="1" /><rect x="9.75" y="7" width="4.5" height="14" rx="1" /><rect x="16.5" y="3" width="4.5" height="18" rx="1" /></svg>; }
function ArrowIcon({ up }: { up: boolean }) { return <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{up ? <path d="M6 18 18 6m0 0H9m9 0v9" /> : <path d="M6 6l12 12m0 0V9m0 9H9" />}</svg>; }
function TargetIcon() { return <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="13" r="8" /><circle cx="11" cy="13" r="4.5" /><circle cx="11" cy="13" r="1.3" fill="currentColor" /><path d="m11 13 9-9m0 0h-4m4 0v4" /></svg>; }

/* The reference design's figures (H1, Apr–Sep), used by tests and design checks. */
export const SAMPLE_YEAR: ForecastYear = {
  fy: 2024,
  forecast: [36, 38, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49].map((v) => v * CRORE),
  actual: [38, 40, 39, 44, 46, 51, 0, 0, 0, 0, 0, 0].map((v) => v * CRORE),
};
