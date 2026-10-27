import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { peekReportCache } from '../api/client';
import { reportApi, type SalesSummary } from '../api/data';
import { Chart } from '../components/Chart';

/* ------------------------------------------------------------------ palette */
const NAVY = '#0b1b4d';
const GRID = '#e2e8f0';
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
// Bars run cyan -> blue -> violet from the first to the last year.
const BAR_STOPS = ['#14c4a4', '#16b4d6', '#1f8fe5', '#2563eb', '#5b3fd6'];
const DECLINE = { top: '#ff8a4c', bottom: '#ef4444' };
const ARROW_FROM = '#fde3c8';
const ARROW_TO = '#f97316';
const CONNECTOR = '#6d4ed8';

/* -------------------------------------------------------------------- model */

export interface Point { label: string; value: number }
export interface Row extends Point { change: number | null; growth: number | null }

export function buildRows(points: Point[]): Row[] {
  return points.map((p, i) => {
    const prev = i === 0 ? null : points[i - 1].value;
    return { ...p, change: prev === null ? null : p.value - prev, growth: prev === null || prev === 0 ? null : ((p.value - prev) / prev) * 100 };
  });
}

/* --------------------------------------------------------------- milestones */

export interface Milestone { kind: 'base' | 'step' | 'final'; mult: number; idx: number; color: string; tint: string }
const MILESTONE_COLORS = [
  { color: '#16a34a', tint: '#dcfce7' }, { color: '#f97316', tint: '#ffedd5' }, { color: '#7c3aed', tint: '#ede9fe' },
  { color: '#0891b2', tint: '#cffafe' }, { color: '#db2777', tint: '#fce7f3' }, { color: '#ca8a04', tint: '#fef9c3' },
];

/** The multiples worth marking: every whole multiple when growth is small, coarser steps when it is large. */
function stepMultiples(max: number): number[] {
  if (max < 2) return [];
  const step = max <= 6 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
  const out = [2];
  for (let k = step; k <= max; k += step) if (k > 2) out.push(k);
  return out;
}

/** 1× at the first year, then the first year turnover reached 2×, 3×… of it, then where it ends. */
export function milestones(rows: Row[]): Milestone[] {
  if (rows.length < 3 || rows[0].value <= 0) return [];
  const base = rows[0].value;
  const out: Milestone[] = [{ kind: 'base', mult: 1, idx: 0, color: '#2563eb', tint: '#dbeafe' }];
  for (const k of stepMultiples(Math.max(...rows.map((r) => r.value)) / base)) {
    const idx = rows.findIndex((r) => r.value >= k * base);
    if (idx <= 0) continue;
    const c = MILESTONE_COLORS[(out.length - 1) % MILESTONE_COLORS.length];
    const same = out.findIndex((m) => m.idx === idx);
    if (same > 0) out[same] = { ...out[same], mult: k }; // two multiples crossed in one year: keep the higher
    else out.push({ kind: 'step', mult: k, idx, ...c });
  }
  const last = rows.length - 1;
  const finalMult = rows[last].value / base;
  if (!out.some((m) => m.idx === last) && finalMult >= 1.5 && Math.abs(finalMult - Math.round(finalMult)) > 0.05) {
    out.push({ kind: 'final', mult: finalMult, idx: last, color: '#6d28d9', tint: '#ede9fe' });
  }
  return out;
}
const multText = (m: Milestone) => (m.kind === 'final' ? `${m.mult.toFixed(1)}×` : `${m.mult}×`);

function shortFy(fy: number) { return `FY${String(fy + 1).slice(-2)}`; }

/** Rupees-crore with precision that suits the size of the number. */
export function cr(value: number) {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return value.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

/* ---------------------------------------------------------------- component */

export function TurnoverPage() {
  const [report, setReport] = useState<SalesSummary | null>(() => peekReportCache('/api/reports/sales-summary') ?? null);
  const [error, setError] = useState('');
  useEffect(() => { void reportApi.salesSummary().then(setReport).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center text-rose-600">{error}</div>;
  if (!report) return null;
  if (!report.periods.length) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">No sales data is available. Upload and import a Sales Register file to populate this page.</div>;

  // With two or more financial years the page shows the annual trend; with a
  // single year it shows that year's billing periods in the same layout.
  const annual = (report.years?.length ?? 0) >= 2;
  const points: Point[] = annual
    ? report.years.map((y) => ({ label: shortFy(y.fy), value: y.amount_paise / 1_000_000_000 }))
    : report.periods.map((p) => ({ label: p.label, value: p.amount_paise / 1_000_000_000 }));
  return <TurnoverView rows={buildRows(points)} annual={annual} fyLabel={report.fy === null ? '' : shortFy(report.fy)} />;
}

export function TurnoverView({ rows, annual, fyLabel }: { rows: Row[]; annual: boolean; fyLabel: string }) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const declines = rows.filter((r) => r.change !== null && r.change < 0);
  const worst = declines.reduce<Row | null>((w, r) => (w === null || (r.growth ?? 0) < (w.growth ?? 0) ? r : w), null);
  const best = rows.reduce<Row | null>((b, r) => (r.growth !== null && (b === null || r.growth > (b.growth ?? -Infinity)) ? r : b), null);
  const multiple = first.value > 0 ? last.value / first.value : null;
  const steps = rows.length - 1;
  const cagr = annual && multiple !== null && multiple > 0 && steps > 0 ? (Math.pow(multiple, 1 / steps) - 1) * 100 : null;
  const unit = annual ? 'year' : 'period';
  const range = rows.length > 1 ? `${first.label} – ${last.label}` : first.label;
  const title = annual ? `Annual Turnover Trend (${range})` : `Turnover Trend – ${fyLabel} (${range})`;

  const takeaways: { dot: string; text: ReactNode }[] = [];
  if (rows.length > 1 && multiple !== null) {
    takeaways.push({ dot: '#14b8a6', text: <>Turnover {last.value >= first.value ? 'increased' : 'decreased'} from <b>₹{cr(first.value)} Cr</b> in {first.label} to <b>₹{cr(last.value)} Cr</b> in {last.label}{multiple >= 1 ? <>, a growth of <b>{multiple.toFixed(1)}× ({((multiple - 1) * 100).toFixed(0)}%)</b></> : null}.</> });
  } else {
    takeaways.push({ dot: '#14b8a6', text: <>Turnover for {first.label}: <b>₹{cr(first.value)} Cr</b>.</> });
  }
  if (cagr !== null) takeaways.push({ dot: '#7c3aed', text: <>CAGR over {steps + 1} years: <b>{cagr.toFixed(1)}%</b>.</> });
  else if (rows.length > 1) takeaways.push({ dot: '#7c3aed', text: <>Average per {unit}: <b>₹{cr(rows.reduce((s, r) => s + r.value, 0) / rows.length)} Cr</b>.</> });
  if (worst) {
    const lead = declines.length === 1 ? `One ${unit} of decline observed in ${worst.label}` : `${declines.length} ${unit}s of decline; the largest in ${worst.label}`;
    takeaways.push({ dot: '#ef4444', text: <>{lead}: <b>₹{cr(Math.abs(worst.change ?? 0))} Cr ({(worst.growth ?? 0).toFixed(1)}%)</b>.</> });
  } else if (rows.length > 1) {
    takeaways.push({ dot: '#ef4444', text: <>No decline: turnover rose in every {unit}.</> });
  }
  if (best && (best.growth ?? 0) > 0) takeaways.push({ dot: '#16a34a', text: <>Highest {annual ? 'year-on-year' : 'period-on-period'} growth: <b>{(best.growth ?? 0).toFixed(1)}% in {best.label} (₹{cr(best.change ?? 0)} Cr increase)</b>.</> });
  const mk = milestones(rows).filter((m) => m.kind === 'step');
  if (mk.length) {
    takeaways.push({ dot: '#7c3aed', text: <>Key milestones (base ₹{cr(first.value)} Cr in {first.label}): {mk.map((m, i) => (
      <span key={m.mult}>{i > 0 ? '; ' : ''}<b style={{ color: m.color }}>{m.mult}×</b> (₹{cr(m.mult * first.value)} Cr) reached in <b>{rows[m.idx].label}</b>{m.idx > 0 ? ` (₹${cr(rows[m.idx - 1].value)} → ₹${cr(rows[m.idx].value)})` : ''}</span>
    ))}.</> });
  }
  if (rows.length >= 5) {
    const steady = last.value > first.value && declines.length <= Math.max(1, Math.floor(steps / 5));
    takeaways.push({ dot: '#2563eb', text: steady ? <>Overall trend shows steady and consistent growth in turnover over the {rows.length} {unit}s.</> : <>Turnover has moved unevenly across the {rows.length} {unit}s; check the highlighted {unit}s.</> });
  }

  const span = rows.length > 1 ? `(${first.label} to ${last.label})` : '';
  const lowest = rows.reduce((m, r) => (r.value < m.value ? r : m), first);
  const stats: Stat[] = [];
  if (rows.length > 1 && first.value > 0) {
    const pct = (last.value / first.value - 1) * 100;
    stats.push({ label: annual ? `${steps + 1}-year growth` : 'Growth', note: span, value: `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`, tint: pct >= 0 ? 'green' : 'red', icon: 'bars', art: 'rise' });
  }
  if (cagr !== null) stats.push({ label: 'CAGR', note: span, value: `${cagr.toFixed(1)}%`, tint: 'violet', icon: 'trend', art: 'bars' });
  else if (rows.length > 1) stats.push({ label: `Average per ${unit}`, note: span, value: `₹${cr(rows.reduce((a, r) => a + r.value, 0) / rows.length)} Cr`, tint: 'violet', icon: 'trend', art: 'bars' });
  stats.push({ label: `${last.label} turnover`, value: `₹${cr(last.value)} Cr`, tint: 'blue', icon: 'coins', art: 'target' });
  if (rows.length > 1) stats.push({ label: `${first.label} base turnover`, value: `₹${cr(first.value)} Cr`, tint: 'orange', icon: 'stack', art: 'bars' });
  if (worst) stats.push({ label: `Lowest ${unit} (${worst.label})`, value: `₹${cr(worst.value)} Cr`, sub: `${(worst.growth ?? 0).toFixed(1)}% ${annual ? 'YoY' : 'vs previous'}`, tint: 'red', icon: 'down', art: 'none' });
  else if (rows.length > 1) stats.push({ label: `Lowest ${unit} (${lowest.label})`, value: `₹${cr(lowest.value)} Cr`, tint: 'red', icon: 'down', art: 'none' });
  if (best && (best.growth ?? 0) > 0) stats.push({ label: annual ? 'Peak YoY growth' : 'Peak growth', value: `${best.label} +${(best.growth ?? 0).toFixed(1)}%`, tint: 'green', icon: 'bars', art: 'rise', small: true });

  return (
    <div className="relative space-y-4">
      <PageHeader rows={rows} annual={annual} fyLabel={fyLabel} multiple={multiple} />
      <div className={`relative grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${stats.length >= 6 ? '2xl:grid-cols-6' : stats.length >= 4 ? '2xl:grid-cols-4' : ''}`}>
        {stats.map((st) => <StatCard key={st.label} stat={st} />)}
      </div>
      <TrendCard rows={rows} title={title} annual={annual} worst={worst} multiple={multiple} marks={milestones(rows)} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)]">
        <TablesCard rows={rows} annual={annual} worst={worst} best={best} marks={milestones(rows)} />
        <TakeawaysCard items={takeaways} />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- page header */

function PageHeader({ rows, annual, fyLabel, multiple }: { rows: Row[]; annual: boolean; fyLabel: string; multiple: number | null }) {
  const first = rows[0];
  const last = rows[rows.length - 1];
  const accent = 'text-[#1d6fe0]';
  let headline: ReactNode;
  if (rows.length < 2 || multiple === null) {
    headline = <>{first.label} turnover is <span className={accent}>₹{cr(first.value)} Cr</span></>;
  } else if (annual && multiple >= 1.5) {
    headline = <>Turnover grew <span className={accent}>{multiple.toFixed(1)}×</span> in <span className={accent}>{rows.length} years</span></>;
  } else {
    const pct = (multiple - 1) * 100;
    const span = annual ? `${rows.length} years` : `${fyLabel} (${first.label} – ${last.label})`;
    headline = <>Turnover {pct >= 0 ? 'grew' : 'fell'} <span className={accent}>{Math.abs(pct).toFixed(1)}%</span> in <span className={accent}>{span}</span></>;
  }
  return (
    <header className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-white via-[#f3f8ff] to-[#e6f1ff] px-6 pb-4 pt-4">
      <Skyline />
      <div className="relative z-10">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-[0.18em] text-[#0e9aa7]">
          <span className="h-4 w-1 rounded-full bg-[#0e9aa7]" />Financial performance
        </div>
        <h1 className="mt-1 font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d] 2xl:text-5xl">{headline}</h1>
        <p className="mt-2 text-base text-[#334155]">
          Turnover is the total sales in a {annual ? 'year' : 'period'}. Each bar represents one {annual ? 'financial year' : 'billing period'} – taller means more sales.
        </p>
      </div>
    </header>
  );
}

/** Faint rising-buildings art in the header's right corner. */
function Skyline() {
  return (
    <svg className="pointer-events-none absolute bottom-0 right-4 hidden h-full w-[300px] md:block" viewBox="0 0 300 120" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
      <defs>
        <linearGradient id="sky-bar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#60a5fa" stopOpacity=".45" /><stop offset="1" stopColor="#bfdbfe" stopOpacity=".15" /></linearGradient>
        <linearGradient id="sky-arrow" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#93c5fd" stopOpacity=".2" /><stop offset="1" stopColor="#2563eb" /></linearGradient>
      </defs>
      {[[40, 92, 16], [62, 80, 18], [86, 66, 18], [110, 72, 16], [132, 50, 20], [158, 58, 18], [182, 34, 22], [210, 44, 18], [234, 22, 24], [262, 38, 20]].map(([x, y, w]) => (
        <rect key={x} x={x} y={y} width={w} height={120 - y} fill="url(#sky-bar)" />
      ))}
      <path d="M30 100 C 110 92, 190 60, 270 8" fill="none" stroke="url(#sky-arrow)" strokeWidth="4" strokeLinecap="round" />
      <path d="M258 6 L276 4 L270 21" fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ------------------------------------------------------------- stat cards */

type Tint = 'green' | 'violet' | 'blue' | 'orange' | 'red';
interface Stat { label: string; note?: string; value: string; sub?: string; tint: Tint; icon: 'bars' | 'trend' | 'coins' | 'stack' | 'down'; art: 'rise' | 'bars' | 'target' | 'none'; small?: boolean }

const TINTS: Record<Tint, { card: string; badge: string; value: string; label: string; art: string }> = {
  green: { card: 'border-emerald-300 from-emerald-100 to-emerald-50', badge: 'from-emerald-400 to-emerald-600 text-white ring-white/70 shadow-md', value: 'text-emerald-700', label: 'text-[#0b1b4d]', art: '#22c55e' },
  violet: { card: 'border-violet-300 from-violet-100 to-violet-50', badge: 'from-violet-400 to-violet-700 text-white ring-white/70 shadow-md', value: 'text-violet-700', label: 'text-[#0b1b4d]', art: '#8b5cf6' },
  blue: { card: 'border-sky-300 from-sky-100 to-blue-50', badge: 'from-sky-400 to-blue-600 text-white ring-white/70 shadow-md', value: 'text-blue-700', label: 'text-[#0b1b4d]', art: '#3b82f6' },
  orange: { card: 'border-orange-300 from-orange-100 to-amber-50', badge: 'from-amber-400 to-orange-600 text-white ring-white/70 shadow-md', value: 'text-orange-600', label: 'text-[#0b1b4d]', art: '#fb923c' },
  red: { card: 'border-rose-300 from-rose-100 to-rose-50', badge: 'from-rose-400 to-rose-600 text-white ring-white/70 shadow-md', value: 'text-rose-600', label: 'text-rose-600', art: '#f43f5e' },
};

function StatCard({ stat }: { stat: Stat }) {
  const t = TINTS[stat.tint];
  return (
    <div className={`relative flex min-h-[112px] items-center gap-3 overflow-hidden rounded-2xl border bg-gradient-to-br px-4 py-3 shadow-sm 2xl:gap-2.5 2xl:px-3 ${t.card}`}>
      <span className={`grid h-12 w-12 2xl:h-11 2xl:w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br shadow-sm ring-1 ${t.badge}`}><StatIcon name={stat.icon} /></span>
      {/* The value scales with the card's width (container units) so it never runs out of the card. */}
      <div className="@container relative z-10 min-w-0 flex-1">
        <div className={`text-[14px] font-semibold leading-tight ${t.label}`}>{stat.label}</div>
        {stat.note && <div className="text-[12px] leading-tight text-[#334155]">{stat.note}</div>}
        <div className={`mt-1 whitespace-nowrap font-heading font-extrabold leading-none tracking-tight ${stat.small ? 'text-[clamp(14px,11cqi,22px)]' : 'text-[clamp(16px,15cqi,28px)]'} ${t.value}`}>{stat.value}</div>
        {stat.sub && <div className={`mt-1 text-[13px] font-bold ${t.value}`}>{stat.sub}</div>}
      </div>
      <StatArt kind={stat.art} color={t.art} />
    </div>
  );
}

function StatIcon({ name }: { name: Stat['icon'] }) {
  const p = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'bars': return <svg {...p}><path d="M5 20v-6M10 20V9M15 20v-8M20 20V5M3 20h19" /></svg>;
    case 'trend': return <svg {...p}><path d="M4 20v-3M9 20v-6M14 20v-5M19 20v-9M3 13l5-4 4 3 7-6m0 0h-4m4 0v4" /></svg>;
    case 'coins': return <svg {...p}><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" /></svg>;
    case 'stack': return <svg {...p}><ellipse cx="12" cy="5.5" rx="8" ry="2.5" /><path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13M4 10c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5M4 14.3c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5" /></svg>;
    case 'down': return <svg {...p}><path d="M4 7l6 6 3-3 7 7m0 0v-5m0 5h-5" /></svg>;
  }
}

/** Faint decoration on the right edge of a stat card. */
function StatArt({ kind, color }: { kind: Stat['art']; color: string }) {
  if (kind === 'none') return null;
  const cls = 'pointer-events-none absolute bottom-2 right-3 h-[64px] w-[64px] opacity-100 2xl:bottom-1.5 2xl:right-2 2xl:h-[40px] 2xl:w-[40px] 2xl:opacity-80';
  if (kind === 'target') {
    return <svg className={cls} viewBox="0 0 64 64" fill="none" stroke={color} strokeWidth="5" opacity=".75" aria-hidden="true"><circle cx="30" cy="34" r="24" opacity=".5" /><circle cx="30" cy="34" r="14" /><circle cx="30" cy="34" r="4" fill={color} /><path d="M30 34 54 10m0 0h-9m9 0v9" strokeLinecap="round" /></svg>;
  }
  return (
    <svg className={cls} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="4" y="40" width="12" height="22" rx="2" fill={color} opacity=".35" />
      <rect x="22" y="30" width="12" height="32" rx="2" fill={color} opacity=".5" />
      <rect x="40" y={kind === 'rise' ? 18 : 14} width="12" height={kind === 'rise' ? 44 : 48} rx="2" fill={color} opacity=".7" />
      {kind === 'rise' && <path d="M4 34 C 22 30, 38 18, 58 4 m0 0 h-10 m10 0 v10" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" opacity=".85" />}
    </svg>
  );
}

/* --------------------------------------------------------------- trend card */

function TrendCard({ rows, title, annual, worst, multiple, marks }: { rows: Row[]; title: string; annual: boolean; worst: Row | null; multiple: number | null; marks: Milestone[] }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const values = rows.map((r) => r.value);
    const labels = rows.map((r) => r.label);
    const top = Math.max(...values, 0);
    const pad = top * 0.14 || 1;
    const n = rows.length;
    const showArrow = n >= 5 && multiple !== null && multiple > 1;
    // A smooth curve above the bars, rising from the first to the last bar.
    const start = values[0] + pad * 1.3;
    const end = Math.max(values[n - 1], top) + pad * 1.3;
    const arrow = values.map((v, i) => Math.max(start + (end - start) * Math.pow(i / Math.max(1, n - 1), 1.6), v + pad * 1.2));
    const declineIdx = worst ? labels.indexOf(worst.label) : -1;
    // The decline callout sits just above the growth arrow at that bar.
    const calloutAt = declineIdx < 0 ? 0 : Math.max(values[declineIdx] + pad * 2.2, (showArrow ? arrow[declineIdx] : 0) + pad * 0.9);
    const yMax = niceCeil(Math.max(top + pad * 2.2, showArrow ? Math.max(...arrow) + pad * 0.6 : 0, declineIdx >= 0 ? calloutAt + pad * 1.7 : 0));
    const dense = n > 14;
    // Room above the highest milestone dot for its card (~30% of the plot height).
    const markTop = marks.length ? Math.max(...marks.map((m) => (showArrow ? arrow[m.idx] : values[m.idx] + pad * 0.9))) : 0;
    const yTop = marks.length ? niceCeil(Math.max(yMax, markTop * 1.45)) : yMax;

    const bars = rows.map((r, i) => {
      const fall = r.change !== null && r.change < 0;
      return {
        value: r.value,
        itemStyle: { color: fall ? vGradient(DECLINE.top, DECLINE.bottom) : vGradient(lighten(barColor(i / Math.max(1, n - 1)), 0.22), barColor(i / Math.max(1, n - 1))), borderRadius: [4, 4, 0, 0] },
        label: { color: fall ? '#dc2626' : NAVY, fontSize: i === n - 1 && n > 1 ? 15 : dense ? 11 : 12 },
      };
    });

    const series: unknown[] = [
      {
        name: 'Turnover', type: 'bar', data: bars, barWidth: dense ? '68%' : '56%', barMaxWidth: 110, z: 2,
        label: { show: true, position: 'top', distance: 6, fontWeight: 800, formatter: ({ value }: { value: number }) => `₹${cr(value)}` },
        markLine: declineIdx >= 0 ? {
          silent: true, symbol: ['none', 'triangle'], symbolSize: [0, 12],
          lineStyle: { color: '#ef4444', width: 2, type: 'solid' },
          label: {
            show: true, position: 'start', distance: 6, align: 'center', lineHeight: 17,
            formatter: `{year|${worst!.label}}\n{copy|Turnover declined by}\n{loss|₹${cr(Math.abs(worst!.change ?? 0))} Cr (${(worst!.growth ?? 0).toFixed(1)}%)}`,
            backgroundColor: '#fff1f2', borderColor: '#f87171', borderWidth: 1, borderRadius: 10, padding: [8, 14],
            shadowColor: 'rgba(239,68,68,.18)', shadowBlur: 10,
            rich: { year: { color: '#dc2626', fontWeight: 800, fontSize: 13 }, copy: { color: NAVY, fontSize: 12 }, loss: { color: '#dc2626', fontWeight: 800, fontSize: 14 } },
          },
          data: [[{ coord: [declineIdx, calloutAt] }, { coord: [declineIdx, values[declineIdx] + pad * 0.75] }]],
        } : undefined,
      },
      // Thin connector with dots on each bar top, as in the reference.
      {
        name: 'connector', type: 'line', data: values, z: 3, symbol: 'circle', symbolSize: 6, silent: true,
        lineStyle: { color: CONNECTOR, width: 1, opacity: 0.55 }, itemStyle: { color: CONNECTOR, borderColor: '#fff', borderWidth: 1.5 },
        tooltip: { show: false },
      },
    ];
    if (showArrow) {
      series.push({
        name: 'growth', type: 'line', data: arrow, smooth: 0.4, z: 1, silent: true, tooltip: { show: false },
        symbol: 'path://M0,0 L20,9 L0,18 L5,9 Z',
        symbolSize: (_v: number, p: { dataIndex: number }) => (p.dataIndex === n - 1 ? [26, 22] : 0),
        symbolRotate: -18, symbolOffset: [8, 0],
        itemStyle: { color: ARROW_TO },
        lineStyle: { width: 6, cap: 'round', color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: ARROW_FROM }, { offset: 1, color: ARROW_TO }] }, shadowColor: 'rgba(249,115,22,.25)', shadowBlur: 6 },
        // The badge is the marker itself, sitting on the arrow near its head.
        markPoint: {
          silent: true, symbol: 'roundRect', symbolSize: [118, 32], symbolRotate: 12, symbolOffset: [0, -22],
          itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#fb923c' }, { offset: 1, color: '#ea580c' }] }, shadowColor: 'rgba(234,88,12,.35)', shadowBlur: 8 },
          label: { show: true, position: 'inside', rotate: 12, formatter: `${multiple!.toFixed(1)}× Growth`, color: '#fff', fontSize: 15, fontWeight: 800 },
          data: [{ coord: [n - 2.6, arrow[n - 3]] }],
        },
      });
    }

    // Milestone callouts (1×, 2×, 3×…): a coloured dot on the growth line with a card above it.
    if (marks.length) {
      const y = (i: number) => (showArrow ? arrow[i] : values[i] + pad * 0.9);
      series.push({
        name: 'milestones', type: 'scatter', z: 12, silent: true, tooltip: { show: false }, symbol: 'circle', symbolSize: 13,
        data: marks.filter((m) => !(m.kind === 'final' && m.idx === declineIdx)).map((m, k) => {
          const r = rows[m.idx];
          const prev = m.idx > 0 ? rows[m.idx - 1] : null;
          const body = m.kind === 'base' ? `{t|(Base)}\n{v|₹${cr(r.value)} Cr}\n{t|${r.label}}`
            : m.kind === 'final' ? `{v|₹${cr(r.value)} Cr}\n{t|${r.label}}`
            : `{v|₹${cr(m.mult * rows[0].value)} Cr}\n{t|Reached between}\n{t|${prev!.label} (₹${cr(prev!.value)}) and}\n{t|${r.label} (₹${cr(r.value)})}`;
          return {
            value: [m.idx, y(m.idx)],
            itemStyle: { color: m.color, borderColor: '#fff', borderWidth: 2.5, shadowColor: 'rgba(15,23,42,.25)', shadowBlur: 4 },
            label: {
              show: true, position: 'top', distance: 12 + (k % 2) * 22, align: 'center', lineHeight: 15,
              offset: declineIdx >= 0 && Math.abs(m.idx - declineIdx) <= 1 ? [m.idx < declineIdx ? -60 : m.idx > declineIdx ? 60 : -95, 0] : [0, 0],
              backgroundColor: m.tint, borderColor: m.color, borderWidth: 1.5, borderRadius: 10, padding: [6, 10],
              formatter: `{b|${multText(m)}}\n${body}`,
              rich: {
                b: { color: '#fff', backgroundColor: m.color, borderRadius: 11, padding: [3, 8], fontSize: 13, fontWeight: 800, lineHeight: 26 },
                v: { color: NAVY, fontSize: 13, fontWeight: 800, lineHeight: 18 },
                t: { color: '#334155', fontSize: 10.5, lineHeight: 14 },
              },
            },
          };
        }),
      });
    }

    return {
      textStyle: { fontFamily: FONT },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'shadow' },
        backgroundColor: '#fff', borderColor: '#e5e7eb', borderWidth: 1, padding: [12, 14],
        extraCssText: 'z-index:9999;border-radius:14px;box-shadow:0 12px 32px rgba(15,23,42,.16);white-space:nowrap;',
        // Turnover plus how it moved against the previous year: amount, %, and how many times last year's turnover.
        formatter: (items: { dataIndex: number }[]) => turnoverTip(rows, items[0]?.dataIndex ?? 0, annual),
      },
      grid: { left: 70, right: 36, top: 24, bottom: 58 },
      xAxis: {
        type: 'category', data: labels, axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } },
        axisLabel: { color: NAVY, fontSize: 12, fontWeight: 500, interval: 0 },
        name: annual ? 'Financial Year' : 'Billing Period', nameLocation: 'middle', nameGap: 38, nameTextStyle: { color: NAVY, fontSize: 13, fontWeight: 700 },
      },
      yAxis: {
        type: 'value', min: 0, max: yTop, axisLine: { show: true, lineStyle: { color: '#94a3b8' } },
        axisLabel: { color: NAVY, fontSize: 13, fontWeight: 500 }, splitLine: { lineStyle: { color: GRID } },
        name: annual ? 'Annual Turnover (₹ Crore)' : 'Turnover (₹ Crore)', nameLocation: 'middle', nameGap: 48, nameTextStyle: { color: NAVY, fontSize: 13, fontWeight: 700 },
      },
      series,
    };
  }, [rows, annual, worst, multiple, marks]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white px-5 pb-3 pt-4 shadow-sm">
      <h2 className="font-heading text-2xl font-extrabold tracking-tight text-[#0b1b4d]">{title}</h2>
      <div className="text-base font-bold text-[#1d4ed8]">Turnover (₹ Crore)</div>
      <div className={`mt-1 w-full ${marks.length ? 'h-[500px]' : 'h-[440px]'}`}>
        <Chart option={option} className="h-full w-full" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- tables card */

function TablesCard({ rows, annual, worst, best, marks }: { rows: Row[]; annual: boolean; worst: Row | null; best: Row | null; marks: Milestone[] }) {
  const half = Math.ceil(rows.length / 2);
  const split = rows.length > 6;
  return (
    <section className="relative isolate overflow-hidden rounded-2xl border border-sky-100 bg-gradient-to-br from-[#d9e9ff] via-[#ecf3ff] to-[#e9e0ff] p-4 shadow-sm">
      {/* Faint rising bars in the corner, matching the page's other decorated cards. */}
      <svg className="pointer-events-none absolute right-2 top-0 -z-10 h-14 w-40" viewBox="0 0 220 110" aria-hidden="true">
        {[[110, 70], [138, 55], [166, 38], [194, 20]].map(([x, y]) => <rect key={x} x={x} y={y} width="20" height={110 - y} rx="3" fill="#c7dbff" opacity=".55" />)}
        <path d="M96 78 C 140 66, 170 44, 214 12" fill="none" stroke="#9cbcf5" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      </svg>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-[#1f8fe5] to-[#1d4ed8] text-white shadow-sm"><TableIcon /></span>
        <h2 className="font-heading text-xl font-bold text-[#0b1b4d]">{annual ? 'Year-wise' : 'Period-wise'} Turnover and Growth Details</h2>
      </div>
      <div className={`grid gap-4 ${split ? 'md:grid-cols-2' : ''}`}>
        <DetailTable rows={split ? rows.slice(0, half) : rows} annual={annual} worst={worst} best={best} marks={marks} all={rows} />
        {split && <DetailTable rows={rows.slice(half)} annual={annual} worst={worst} best={best} marks={marks} all={rows} />}
      </div>
    </section>
  );
}

function DetailTable({ rows, annual, worst, best, marks, all }: { rows: Row[]; annual: boolean; worst: Row | null; best: Row | null; marks: Milestone[]; all: Row[] }) {
  return (
    <div className="self-start overflow-hidden rounded-lg border border-white bg-white shadow-[0_4px_14px_rgba(29,78,216,0.08)]">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead>
          <tr className="text-[13px] font-semibold leading-tight text-white">
            <th className="w-[24%] bg-[#0f6e86] px-2 py-2">{annual ? 'FY' : 'Period'}</th>
            <th className="w-[25%] bg-[#0e9aa7] px-2 py-2">Turnover<br />(₹ Cr)</th>
            <th className="w-[25%] bg-[#6d4ed8] px-2 py-2">{annual ? 'YoY change' : 'Change'}<br />(₹ Cr)</th>
            <th className="w-[26%] bg-[#f39c34] px-2 py-2">{annual ? 'YoY growth' : 'Growth'}<br />(%)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isWorst = worst?.label === r.label;
            const isBest = best?.label === r.label && (best.growth ?? 0) > 0;
            // A milestone year (1×, 2×, 3×…) gets its colour and a badge; the worst decline stays red.
            const mark = marks.find((m) => all[m.idx]?.label === r.label);
            const tone = isWorst ? 'bg-rose-100 font-bold text-[#dc2626]' : mark ? 'font-bold text-[#0b1b4d]' : isBest ? 'bg-emerald-100 font-bold text-[#15803d]' : 'text-[#0b1b4d] odd:bg-white even:bg-[#f1f7fd]';
            return (
              <tr key={r.label} className={`${tone} border-t border-slate-200 text-center`} style={mark && !isWorst ? { background: mark.tint } : undefined}>
                <td className="relative whitespace-nowrap px-2 py-1 font-bold">
                  {mark && <span className="absolute left-1 top-1/2 grid h-6 min-w-6 -translate-y-1/2 place-items-center rounded-full px-1 text-[11px] font-extrabold text-white shadow-sm" style={{ background: mark.color }}>{multText(mark)}</span>}
                  {r.label}
                </td>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums">{cr(r.value)}</td>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums">{r.change === null ? '-' : cr(r.change)}</td>
                <td className="whitespace-nowrap px-2 py-1 tabular-nums">{r.growth === null ? '-' : `${r.growth.toFixed(1)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------- takeaways card */

function TakeawaysCard({ items }: { items: { dot: string; text: ReactNode }[] }) {
  return (
    <section className="rounded-2xl border border-sky-100 bg-gradient-to-br from-[#eef6ff] to-[#f5f9ff] p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2.5">
        <BulbIcon />
        <h2 className="font-heading text-xl font-bold text-[#0b1b4d]">Key Takeaways</h2>
      </div>
      <ul className="space-y-3">
        {items.map((t, i) => (
          <li key={i} className="flex gap-3 text-[15px] leading-snug text-[#0b1b4d]">
            <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full shadow-sm" style={{ background: t.dot }} />
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ helpers */

/* ------------------------------------------------------------ hover card */

const TIP_ICON = {
  bars: (c: string) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="${c}"><rect x="3" y="12" width="4.5" height="9" rx="1"/><rect x="9.75" y="8" width="4.5" height="13" rx="1"/><rect x="16.5" y="4" width="4.5" height="17" rx="1"/></svg>`,
  down: (c: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6l7 7 3-3 6 6m0 0v-5m0 5h-5"/></svg>`,
  up: (c: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 18l7-7 3 3 6-6m0 0v5m0-5h-5"/></svg>`,
  multiple: (c: string) => `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><path d="M5 20v-5M10 20v-8M15 20v-6M20 20V8M4 12l5-4 4 3 7-6"/></svg>`,
};

/** Hover card for one year: title tile and amount pill, then change and growth-multiple rows. */
function turnoverTip(rows: Row[], i: number, annual: boolean): string {
  const r = rows[i];
  const prev = i > 0 ? rows[i - 1] : null;
  const fell = r.change !== null && r.change < 0;
  const t = fell
    ? { tile: '#fff1e6', icon: '#f97316', pill: '#ffe9dc', amount: '#ef4b2b' }
    : { tile: '#e8f1ff', icon: '#1d6fe0', pill: '#e6f0ff', amount: '#1d4ed8' };
  const circle = (bg: string, svg: string) => `<span style="display:inline-grid;place-items:center;width:28px;height:28px;border-radius:50%;background:${bg};flex:none">${svg}</span>`;
  const row = (icon: string, label: string, value: string, color: string) =>
    `<div style="display:flex;align-items:center;gap:10px;margin-top:8px">${icon}<span style="flex:1;color:#475569;font-size:12.5px">${label}</span><b style="color:${color};font-size:13px;margin-left:14px">${value}</b></div>`;
  const head = `<div style="display:flex;align-items:center;gap:10px;min-width:260px">
      <span style="display:inline-grid;place-items:center;width:36px;height:36px;border-radius:10px;background:${t.tile};flex:none">${TIP_ICON.bars(t.icon)}</span>
      <div style="flex:1;line-height:1.15"><div style="font-size:16px;font-weight:800;color:#0b1b4d">${r.label}</div><div style="font-size:11.5px;color:#64748b">Turnover</div></div>
      <span style="background:${t.pill};color:${t.amount};font-size:17px;font-weight:800;padding:5px 11px;border-radius:10px;margin-left:12px">₹${cr(r.value)} Cr</span>
    </div>`;
  if (!prev || r.change === null) {
    return `${head}<div style="border-top:1px solid #e5e7eb;margin-top:10px;padding-top:8px;color:#64748b;font-size:12px">First ${annual ? 'year' : 'period'} in the data</div>`;
  }
  const changeColor = fell ? '#e11d48' : '#16a34a';
  const change = `${fell ? '−' : '+'}₹${cr(Math.abs(r.change))} Cr${r.growth !== null ? `&nbsp;&nbsp;(${fell ? '−' : '+'}${Math.abs(r.growth).toFixed(1)}%)` : ''}`;
  const times = prev.value > 0 ? r.value / prev.value : null;
  return head
    + `<div style="border-top:1px solid #e5e7eb;margin-top:10px;padding-top:0">`
    + row(circle(fell ? '#ffe4e6' : '#dcfce7', (fell ? TIP_ICON.down : TIP_ICON.up)(changeColor)), `vs ${prev.label}`, change, changeColor)
    + (times !== null ? row(circle('#ede9fe', TIP_ICON.multiple('#2563eb')), 'Growth multiple', `${times.toFixed(2)}× of ${prev.label}`, '#7c3aed') : '')
    + `</div>`;
}

function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => Math.ceil(v / s) <= 8) ?? p * 10;
  return Math.ceil(v / step) * step;
}
function vGradient(top: string, bottom: string) {
  return { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }] };
}
function barColor(t: number) {
  const seg = Math.min(BAR_STOPS.length - 2, Math.floor(t * (BAR_STOPS.length - 1)));
  return mix(BAR_STOPS[seg], BAR_STOPS[seg + 1], t * (BAR_STOPS.length - 1) - seg);
}
function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number) {
  const x = hexToRgb(a), y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
function lighten(rgb: string, amt: number) {
  const m = rgb.match(/\d+/g)!.map(Number);
  const c = m.map((v) => Math.round(v + (255 - v) * amt));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function TableIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
}
function BulbIcon() {
  return <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5.9 1.1.9 1.9V17h5.4v-1.3c0-.8.3-1.4.9-1.9A6 6 0 0 0 12 3Z" fill="#fde68a" stroke="#0e9aa7" strokeWidth="1.6" /><path d="M9.5 19.5h5M10.5 21.5h3" stroke="#0e9aa7" strokeWidth="1.6" strokeLinecap="round" /><path d="M12 0.8v1.2M3.5 4.5l.9.9M20.5 4.5l-.9.9M1 11h1.3M21.7 11H23" stroke="#f59e0b" strokeWidth="1.4" strokeLinecap="round" /></svg>;
}

/* Kept for tests and design reference: the original 20-year sample. */
export const SAMPLE_POINTS: Point[] = ['FY06', 'FY07', 'FY08', 'FY09', 'FY10', 'FY11', 'FY12', 'FY13', 'FY14', 'FY15', 'FY16', 'FY17', 'FY18', 'FY19', 'FY20', 'FY21', 'FY22', 'FY23', 'FY24', 'FY25']
  .map((label, i) => ({ label, value: [100, 110, 120, 132, 145, 160, 175, 192, 210, 230, 252, 276, 298, 322, 300, 350, 378, 408, 440, 480][i] }));
