import { useEffect, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { ApiError, peekReportCache } from '../api/client';
import { reportApi, type ExpenseYear } from '../api/data';
import { Chart } from '../components/Chart';
import { FyPicker, fyShort } from '../components/FyPicker';

/* ------------------------------------------------------------------ palette */
const NAVY = '#0b1b4d';
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
const PREV = { top: '#7db8ff', bottom: '#4f97f5' };
const CURR = { top: '#1d4fa8', bottom: '#0d3a8a' };
const TEAL = { top: '#4fd0b0', bottom: '#14a38b' };
// For expenses an increase is unfavourable (red) and a decrease favourable (green).
const UP = { text: '#dc2626', bg: '#ffe4e6', border: '#fca5a5' };
const DOWN = { text: '#15803d', bg: '#dcfce7', border: '#86efac' };
const CRORE = 1_000_000_000;
const STALE = '__stale_backend__';
const Q_MONTHS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];
const H_MONTHS = [[0, 1, 2, 3, 4, 5], [6, 7, 8, 9, 10, 11]];
const H_LABELS = ['H1 (Apr–Sep)', 'H2 (Oct–Mar)'];

const num = (paise: number) => {
  const v = Math.abs(paise / CRORE);
  return `${paise < 0 ? '−' : ''}${v.toLocaleString('en-IN', { maximumFractionDigits: v >= 100 ? 0 : v >= 10 ? 1 : 2 })}`;
};
const cr = (paise: number) => `₹${num(paise)} Cr`;
const signed = (paise: number) => `${paise >= 0 ? '+' : '−'}${num(Math.abs(paise))}`;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

/* -------------------------------------------------------------------- model */

export interface Compare { label: string; prev: number | null; curr: number | null; change: number | null; pct: number | null }

/** Sums over the given months; the previous year uses only the months the current year has data for (like for like). */
function compare(label: string, months: number[], curr: ExpenseYear, prev: ExpenseYear | undefined): Compare {
  const have = months.filter((m) => curr.months[m] > 0);
  const c = have.length ? have.reduce((a, m) => a + curr.months[m], 0) : null;
  const pFull = prev ? months.reduce((a, m) => a + prev.months[m], 0) : 0;
  const pLike = prev ? have.reduce((a, m) => a + prev.months[m], 0) : 0;
  const p = prev && pFull ? (c === null ? pFull : pLike || null) : null;
  const change = c !== null && p !== null ? c - p : null;
  return { label, prev: p, curr: c, change, pct: change !== null && p ? (change / p) * 100 : null };
}

export function buildModel(years: ExpenseYear[], fy: number) {
  const curr = years.find((y) => y.fy === fy)!;
  const prev = years.find((y) => y.fy === fy - 1);
  const quarters = Q_MONTHS.map((ms, i) => compare(`Q${i + 1}`, ms, curr, prev));
  const halves = H_MONTHS.map((ms, i) => compare(H_LABELS[i], ms, curr, prev));
  const total = compare('Total (FY)', Q_MONTHS.flat(), curr, prev);
  const monthsWithData = curr.months.filter((v) => v > 0).length;
  const trend = years.filter((y) => y.fy <= fy).slice(-5).map((y) => {
    const t = compare(fyShort(y.fy), Q_MONTHS.flat(), y, years.find((p) => p.fy === y.fy - 1));
    return { ...t, partial: y.months.filter((v) => v > 0).length < 12 };
  });
  return { curr, prev, quarters, halves, total, trend, partial: monthsWithData < 12 };
}

/* ---------------------------------------------------------------- page */

export function ExpensesPage() {
  const [years, setYears] = useState<ExpenseYear[] | null>(() => peekReportCache<{ years: ExpenseYear[] }>('/api/reports/expenses-summary')?.years ?? null);
  const [error, setError] = useState('');
  useEffect(() => {
    void reportApi.expensesSummary().then((r) => setYears(r.years)).catch((e: Error) => setError(e instanceof ApiError && e.status === 404 ? STALE : e.message));
  }, []);
  if (error) return <Notice tone="error">{error === STALE ? 'Expenses: the data service is out of date. Close the app completely and start it again.' : error}</Notice>;
  if (!years) return null;
  if (!years.length) return <NoExpenses />;
  return <ExpensesScreen years={years} />;
}

function Notice({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return <div className={`rounded-2xl border bg-white p-8 text-center ${tone === 'error' ? 'border-rose-200 text-rose-600' : 'border-sky-200 text-muted'}`}>{children}</div>;
}

function NoExpenses() {
  return (
    <div className="space-y-3">
      <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#0e9a6e]">Expenses <span className="mx-2 text-[#94a3b8]">|</span> Quarterly, Half-yearly and Yearly Trends</div>
      <h1 className="font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d]">No expense data uploaded yet</h1>
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[15px] leading-relaxed text-amber-900">
        Go to <b>Upload data</b>, choose <b>Expenses</b> and upload an Excel file with the columns <b>Financial year</b> (e.g. 2025),
        {' '}<b>Period</b> (month 1 = Apr … 12 = Mar), <b>Expense category</b> (e.g. Salaries, Rent) and <b>Expense amount</b> (₹, full rupees).
        One row per category per month. Upload at least two years to see the year-on-year comparison.
      </div>
    </div>
  );
}

function ExpensesScreen({ years }: { years: ExpenseYear[] }) {
  const [fy, setFy] = useState(years[years.length - 1].fy);
  return <ExpensesView years={years} fy={fy} picker={<FyPicker fy={fy} years={years.map((y) => y.fy)} onChange={setFy} />} />;
}

export function ExpensesView({ years, fy, picker }: { years: ExpenseYear[]; fy: number; picker?: ReactNode }) {
  const m = buildModel(years, fy);
  const cur = fyShort(fy);
  const prv = fyShort(fy - 1);
  const t = m.total;
  const up = (t.change ?? 0) >= 0;

  return (
    <div className="relative min-w-0 space-y-3">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#0e9a6e]">Expenses <span className="mx-2 text-[#94a3b8]">|</span> Quarterly, Half-yearly and Yearly Trends</div>
          <h1 className="mt-1 font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d]">
            {t.pct === null ? <>{cur} expenses {cr(t.curr ?? 0)}</> : <>{cur} expenses {up ? 'increased' : 'decreased'} by {Math.abs(t.pct).toFixed(1)}% vs {prv}</>}
          </h1>
        </div>
        <div className="flex flex-wrap items-stretch gap-3">
          <TopCard tone="blue" label={`${prv} Expenses${m.partial && t.prev !== null ? ' (same months)' : ''}`} value={t.prev === null ? '—' : cr(t.prev)} />
          <TopCard tone="violet" label={`${cur} Expenses${m.partial ? ' (YTD)' : ''}`} value={cr(t.curr ?? 0)} />
          <TopCard tone={up ? 'red' : 'green'} up={up} label={up ? 'Increase (YoY)' : 'Decrease (YoY)'} value={t.pct === null ? '—' : pct(t.pct)} sub={t.change === null ? undefined : `(${signed(t.change)} Cr)`} />
          {picker}
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1.15fr]">
        <Panel title="Quarterly Expenses (₹ Cr)" legend={<PairLegend cur={cur} prv={prv} />}>
          <PairChart rows={m.quarters} cur={cur} prv={prv} />
        </Panel>
        <Panel title="Half-Yearly Expenses (₹ Cr)" legend={<PairLegend cur={cur} prv={prv} />}>
          <PairChart rows={m.halves} cur={cur} prv={prv} />
        </Panel>
        <Panel title="Yearly Expenses Trend (₹ Cr)" legend={<TrendLegend />}>
          <TrendChart rows={m.trend} />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.35fr_1fr_1.15fr]">
        <Card title="Quarterly Expense Details (₹ Cr)" icon={<BarsIcon />}>
          <CompareTable first="Quarter" rows={m.quarters} total={t} cur={cur} prv={prv} />
        </Card>
        <Card title="Half-Yearly Expense Details (₹ Cr)" icon={<CoinsIcon />}>
          <CompareTable first="Period" rows={m.halves} total={t} cur={cur} prv={prv} />
        </Card>
        <Card title="Yearly Expense Details (₹ Cr)" icon={<CalendarIcon />}>
          <YearTable rows={m.trend} />
        </Card>
      </div>
      {m.partial && <p className="text-xs text-[#64748b]">{cur} is a part-year: comparisons with {prv} use the same months only.</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- charts */

function badge(change: number | null, p: number | null) {
  if (change === null || p === null) return null;
  const c = change >= 0 ? UP : DOWN;
  return {
    show: true, position: 'top', distance: 26, align: 'center', lineHeight: 15, padding: [4, 8], borderRadius: 7, borderWidth: 1,
    backgroundColor: c.bg, borderColor: c.border,
    formatter: `{a|${change >= 0 ? '↗' : '↘'}} {p|${pct(p)}}\n{v|(${signed(change)} Cr)}`,
    rich: { a: { color: c.text, fontSize: 16, fontWeight: 800 }, p: { color: c.text, fontWeight: 800, fontSize: 13 }, v: { color: c.text, fontSize: 11 } },
  };
}

const grad = (g: { top: string; bottom: string }) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: g.top }, { offset: 1, color: g.bottom }] });
const valueLabel = { show: true, position: 'top', color: NAVY, fontWeight: 800, fontSize: 12, formatter: ({ value }: { value: number | null }) => (value ? value.toLocaleString('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 2 }) : '') };
const yAxis = (top: number) => ({ type: 'value', min: 0, max: niceCeil(top * 1.45), splitNumber: 5, name: 'Expenses (₹ Cr)', nameLocation: 'middle', nameGap: 40, nameTextStyle: { color: NAVY, fontWeight: 700 }, axisLabel: { color: NAVY }, axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, splitLine: { lineStyle: { color: '#e8edf4' } } });
const v = (p: number | null) => (p === null ? null : Number((p / CRORE).toFixed(2)));

function PairChart({ rows, cur, prv }: { rows: Compare[]; cur: string; prv: string }) {
  const top = Math.max(...rows.map((r) => Math.max(r.prev ?? 0, r.curr ?? 0)), 1) / CRORE;
  const option: EChartsCoreOption = {
    textStyle: { fontFamily: FONT },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (x: number | null) => (x === null || x === undefined ? 'No data' : `₹${x} Cr`) },
    grid: { left: 52, right: 12, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: rows.map((r) => r.label), axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 13 } },
    yAxis: yAxis(top),
    series: [
      { name: prv, type: 'bar', barGap: '6%', barWidth: '34%', data: rows.map((r) => v(r.prev)), itemStyle: { color: grad(PREV), borderRadius: [3, 3, 0, 0] }, label: valueLabel },
      { name: cur, type: 'bar', barWidth: '34%', data: rows.map((r) => v(r.curr)), itemStyle: { color: grad(CURR), borderRadius: [3, 3, 0, 0] }, label: valueLabel },
      { name: 'YoY', type: 'scatter', symbolSize: 0, silent: true, z: 10, tooltip: { show: false },
        data: rows.map((r) => (r.change === null ? null : { value: Math.max(r.prev ?? 0, r.curr ?? 0) / CRORE, label: badge(r.change, r.pct) })) },
    ],
  };
  return <div className="h-[300px]"><Chart option={option} className="h-full w-full" /></div>;
}

function TrendChart({ rows }: { rows: (Compare & { partial: boolean })[] }) {
  const top = Math.max(...rows.map((r) => r.curr ?? 0), 1) / CRORE;
  const option: EChartsCoreOption = {
    textStyle: { fontFamily: FONT },
    tooltip: { trigger: 'axis', valueFormatter: (x: number | null) => (x === null || x === undefined ? 'No data' : `₹${x} Cr`) },
    grid: { left: 52, right: 12, top: 20, bottom: 30 },
    xAxis: { type: 'category', data: rows.map((r) => `${r.label}${r.partial ? ' (YTD)' : ''}`), axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 12 } },
    yAxis: yAxis(top),
    series: [
      { name: 'Expenses', type: 'bar', barWidth: '58%', data: rows.map((r) => v(r.curr)), itemStyle: { color: grad(TEAL), borderRadius: [3, 3, 0, 0] } },
      { name: 'Trend', type: 'line', data: rows.map((r) => v(r.curr)), symbol: 'circle', symbolSize: 9, lineStyle: { color: NAVY, width: 2.5 }, itemStyle: { color: NAVY }, tooltip: { show: false },
        label: { show: true, position: 'top', color: NAVY, fontWeight: 800, fontSize: 12, distance: 8, formatter: ({ value }: { value: number }) => value.toLocaleString('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 2 }) } },
      { name: 'YoY', type: 'scatter', symbolSize: 0, silent: true, z: 10, tooltip: { show: false },
        data: rows.map((r) => (r.change === null ? null : { value: (r.curr ?? 0) / CRORE, label: { ...badge(r.change, r.pct), distance: 30, formatter: `{a|${(r.change ?? 0) >= 0 ? '↗' : '↘'}} {p|${pct(r.pct ?? 0)}}` } })) },
    ],
  };
  return <div className="h-[300px]"><Chart option={option} className="h-full w-full" /></div>;
}

function PairLegend({ cur, prv }: { cur: string; prv: string }) {
  return (
    <div className="flex items-center gap-4 text-sm text-[#0b1b4d]">
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-sm" style={{ background: PREV.bottom }} />{prv}</span>
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-sm" style={{ background: CURR.bottom }} />{cur}</span>
      <span className="flex items-center gap-1 font-semibold text-[#dc2626]">↗ <span className="font-normal text-[#0b1b4d]">YoY %</span></span>
    </div>
  );
}
function TrendLegend() {
  return (
    <div className="flex items-center gap-4 text-sm text-[#0b1b4d]">
      <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-sm" style={{ background: TEAL.bottom }} />Expenses (₹ Cr)</span>
      <span className="flex items-center gap-1.5"><span className="relative h-0.5 w-6 bg-[#0b1b4d]"><span className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0b1b4d]" /></span>YoY %</span>
    </div>
  );
}

/* ---------------------------------------------------------------- tables */

const tone = (x: number | null) => (x === null ? 'text-slate-400' : x >= 0 ? 'text-[#dc2626]' : 'text-[#15803d]');
const HEAD = 'break-words px-1 py-2 text-[11.5px] font-semibold leading-tight text-white';

function CompareTable({ first, rows, total, cur, prv }: { first: string; rows: Compare[]; total: Compare; cur: string; prv: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full table-fixed border-collapse text-center text-[12.5px] text-[#0b1b4d]">
        <thead><tr>
          <th className={`${HEAD} bg-[#0b2a6b]`}>{first}</th>
          <th className={`${HEAD} bg-[#1d6fe0]`}>{prv}<br />(₹ Cr)</th>
          <th className={`${HEAD} bg-[#1559d6]`}>{cur}<br />(₹ Cr)</th>
          <th className={`${HEAD} bg-[#f58a1f]`}>Variance<br />(₹ Cr)</th>
          <th className={`${HEAD} bg-[#8b5cf6]`}>Variance<br />(%)</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]">
              <td className="px-2 py-1.5">{r.label}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.prev === null ? '–' : num(r.prev)}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.curr === null ? '–' : num(r.curr)}</td>
              <td className={`bg-[#fff7ed] px-2 py-1.5 font-semibold tabular-nums ${tone(r.change)}`}>{r.change === null ? '–' : signed(r.change)}</td>
              <td className={`px-2 py-1.5 font-semibold tabular-nums ${tone(r.pct)}`}>{r.pct === null ? '–' : pct(r.pct)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-emerald-200 bg-[#dcf5ea] text-[15px] font-extrabold">
            <td className="px-2 py-2">Total (FY)</td>
            <td className="px-2 py-2 tabular-nums">{total.prev === null ? '–' : num(total.prev)}</td>
            <td className="px-2 py-2 tabular-nums">{total.curr === null ? '–' : num(total.curr)}</td>
            <td className={`px-2 py-2 tabular-nums ${tone(total.change)}`}>{total.change === null ? '–' : signed(total.change)}</td>
            <td className={`px-2 py-2 tabular-nums ${tone(total.pct)}`}>{total.pct === null ? '–' : pct(total.pct)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function YearTable({ rows }: { rows: (Compare & { partial: boolean })[] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full table-fixed border-collapse text-center text-[12.5px] text-[#0b1b4d]">
        <thead><tr>
          <th className={`${HEAD} bg-[#0b2a6b]`}>Year</th>
          <th className={`${HEAD} bg-[#1d6fe0]`}>Expenses<br />(₹ Cr)</th>
          <th className={`${HEAD} bg-[#14a38b]`}>YoY Change<br />(₹ Cr)</th>
          <th className={`${HEAD} bg-[#0b2a6b]`}>YoY %</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]">
              <td className="px-2 py-1.5">{r.label}{r.partial ? ' (YTD)' : ''}</td>
              <td className="px-2 py-1.5 tabular-nums">{num(r.curr ?? 0)}</td>
              <td className="px-2 py-1.5 tabular-nums">{r.change === null ? '-' : signed(r.change)}</td>
              <td className={`px-2 py-1.5 font-semibold tabular-nums ${tone(r.pct)}`}>{r.pct === null ? '-' : pct(r.pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- frames */

function Panel({ title, legend, children }: { title: string; legend: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_4px_20px_rgba(15,40,90,0.06)]">
      <div className="bg-gradient-to-r from-[#0b2a6b] via-[#1450b8] to-[#1e88e5] px-5 py-3"><h2 className="font-heading text-lg font-bold text-white">{title}</h2></div>
      <div className="flex justify-end px-4 pt-3">{legend}</div>
      <div className="px-2 pb-2">{children}</div>
    </section>
  );
}

function Card({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-white/80 bg-white/95 p-4 shadow-[0_4px_20px_rgba(15,40,90,0.06)]">
      <h2 className="mb-3 flex items-center gap-2.5 font-heading text-lg font-bold text-[#0b1b4d]"><span className="text-[#1d6fe0]">{icon}</span>{title}</h2>
      {children}
    </section>
  );
}

const TOP = {
  blue: { card: 'border-sky-300 from-sky-100 to-blue-50', tile: 'from-sky-400 to-blue-600 shadow-md', label: 'text-[#1d6fe0]', value: 'text-[#1d4ed8]' },
  violet: { card: 'border-violet-300 from-violet-100 to-violet-50', tile: 'from-violet-400 to-violet-700 shadow-md', label: 'text-[#7c3aed]', value: 'text-[#6d28d9]' },
  red: { card: 'border-rose-300 from-rose-100 to-rose-50', tile: 'from-rose-400 to-rose-600 shadow-md', label: 'text-[#dc2626]', value: 'text-[#dc2626]' },
  green: { card: 'border-emerald-300 from-emerald-100 to-emerald-50', tile: 'from-emerald-400 to-emerald-600 shadow-md', label: 'text-[#15803d]', value: 'text-[#15803d]' },
};

function TopCard({ tone: t, label, value, sub, up }: { tone: keyof typeof TOP; label: string; value: string; sub?: string; up?: boolean }) {
  const s = TOP[t];
  const arrow = up !== undefined;
  return (
    <div className={`flex min-w-[220px] items-center gap-3 rounded-2xl border bg-gradient-to-br px-4 py-3 shadow-sm ${s.card}`}>
      <span className={`grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br ${s.tile} text-white`}>{arrow ? <ArrowIcon up={!!up} /> : <CoinsIcon size={28} />}</span>
      <div className="min-w-0">
        <div className={`text-sm font-bold ${s.label}`}>{label}</div>
        <div className={`whitespace-nowrap font-heading text-[28px] font-extrabold leading-tight ${s.value}`}>{value}</div>
        {sub && <div className={`text-sm font-bold ${s.value}`}>{sub}</div>}
      </div>
    </div>
  );
}

function niceCeil(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const step = [0.2, 0.25, 0.3, 0.5, 1, 2, 2.5, 3, 5, 10].map((k) => k * p).find((s) => Math.ceil(x / s) <= 6) ?? p * 10;
  return Number((Math.ceil(x / step) * step).toFixed(4));
}

function BarsIcon({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="12" width="4.5" height="9" rx="1" /><rect x="9.75" y="7" width="4.5" height="14" rx="1" /><rect x="16.5" y="3" width="4.5" height="18" rx="1" /></svg>; }
function CoinsIcon({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" /></svg>; }
function CalendarIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18M7 14h2m3 0h2m3 0h1M7 17h2m3 0h2" /></svg>; }
function ArrowIcon({ up }: { up: boolean }) { return <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{up ? <path d="M6 18 18 6m0 0H9m9 0v9" /> : <path d="M6 6l12 12m0 0V9m0 9H9" />}</svg>; }

/* The reference design's figures (FY21–FY25), used by tests and design checks. */
const q = (a: number, b: number, c: number, d: number) => [a, a, a, b, b, b, c, c, c, d, d, d].map((x) => (x / 3) * CRORE);
export const SAMPLE_EXPENSES: ExpenseYear[] = [
  { fy: 2020, months: q(75, 80, 80, 85), categories: {} },
  { fy: 2021, months: q(85, 90, 90, 95), categories: {} },
  { fy: 2022, months: q(90, 95, 100, 100), categories: {} },
  { fy: 2023, months: q(95, 100, 105, 110), categories: {} },
  { fy: 2024, months: q(90, 120, 100, 153), categories: {} },
];
