import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { peekReportCache } from '../api/client';
import { reportApi, type SalesSummary } from '../api/data';
import { Chart } from '../components/Chart';
import { FyPicker, fyShort } from '../components/FyPicker';

/* ------------------------------------------------------------------ palette */
const NAVY = '#0b1b4d';
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
const PREV = { top: '#3ee0b0', bottom: '#10b383', solid: '#1cc595' };
const CURR = { top: '#3ea2ff', bottom: '#1559d6', solid: '#2f7cf0' };
const UP = { text: '#15803d', bg: '#dcfce7', border: '#86efac', line: '#16a34a' };
const DOWN = { text: '#dc2626', bg: '#fee2e2', border: '#fca5a5', line: '#ef4444' };
const QUARTER_MONTHS = ['Apr – Jun', 'Jul – Sep', 'Oct – Dec', 'Jan – Mar'];

/* -------------------------------------------------------------------- model */

export interface QuarterRow {
  q: number; // 1..4
  prev: number | null; // ₹ Cr, null when that quarter has no data
  curr: number | null;
  change: number | null;
  growth: number | null;
}

export interface RevenueModel {
  fy: number; // start year of the selected financial year
  hasPrev: boolean;
  rows: QuarterRow[];
}

const CRORE = 1_000_000_000; // paise per crore

export function buildModel(fy: number, curr: number[] | undefined, prev: number[] | undefined): RevenueModel {
  const rows = [0, 1, 2, 3].map((i) => {
    const c = curr && curr[i] ? curr[i] / CRORE : null;
    const p = prev && prev[i] ? prev[i] / CRORE : null;
    const change = c !== null && p !== null ? c - p : null;
    return { q: i + 1, prev: p, curr: c, change, growth: change !== null && p ? (change / p) * 100 : null };
  });
  return { fy, hasPrev: !!prev && prev.some((v) => v > 0), rows };
}

/** Rupees-crore with precision that suits the size of the number. */
export function cr(value: number) {
  const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
  return value.toLocaleString('en-IN', { maximumFractionDigits: digits });
}
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${cr(Math.abs(v))}`;
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

/* ---------------------------------------------------------------- component */

export function RevenuePage() {
  const [report, setReport] = useState<SalesSummary | null>(() => peekReportCache('/api/reports/sales-summary') ?? null);
  const [error, setError] = useState('');
  const [fy, setFy] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void reportApi.salesSummary(fy).then((r) => live && setReport(r)).catch((e: Error) => live && setError(e.message));
    return () => { live = false; };
  }, [fy]);
  if (error) return <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center text-rose-600">{error}</div>;
  if (!report) return null;
  if (!report.periods.length || report.fy === null) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">No sales data is available. Upload and import a Sales Register file to populate this page.</div>;

  // A backend from before quarter totals existed returns no `quarters`; say so instead of showing ₹0.
  if (!report.years?.length || report.years.some((y) => !Array.isArray(y.quarters))) {
    return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-800">The data service is out of date and does not provide quarterly totals yet. Close the app completely and start it again.</div>;
  }
  const year = (y: number) => report.years.find((x) => x.fy === y)?.quarters;
  const model = buildModel(report.fy, year(report.fy), year(report.fy - 1));
  return (
    <div>
      <RevenueView model={model} picker={<FyPicker fy={report.fy} years={report.available_fys} onChange={setFy} />} />
    </div>
  );
}

export function RevenueView({ model, picker }: { model: RevenueModel; picker?: ReactNode }) {
  const { fy, rows, hasPrev } = model;
  const cur = fyShort(fy);
  const prv = fyShort(fy - 1);
  // Compare like for like: only the quarters this year has data for.
  const present = rows.filter((r) => r.curr !== null);
  const partial = present.length < 4;
  const compared = hasPrev ? present.filter((r) => r.prev !== null) : [];
  const currTotal = sum(present.map((r) => r.curr));
  const prevTotal = sum((partial ? compared : rows).map((r) => r.prev));
  const likeCurr = sum(compared.map((r) => r.curr));
  const likePrev = sum(compared.map((r) => r.prev));
  const totalChange = compared.length ? likeCurr - likePrev : null;
  const totalGrowth = totalChange !== null && likePrev ? (totalChange / likePrev) * 100 : null;
  const withGrowth = rows.filter((r) => r.growth !== null);
  const strongest = withGrowth.reduce<QuarterRow | null>((b, r) => (b === null || (r.growth ?? 0) > (b.growth ?? 0) ? r : b), null);
  const declines = withGrowth.filter((r) => (r.change ?? 0) < 0).sort((a, b) => (a.growth ?? 0) - (b.growth ?? 0));
  const comparedLabel = compared.map((r) => `Q${r.q}`).join(', ');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#0e9aa7]">Revenue <span className="mx-2 text-[#94a3b8]">|</span> Quarterly · Half-yearly · Yearly</div>
          <h1 className="mt-1 font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d] 2xl:text-5xl">
            {totalGrowth === null
              ? <>{cur} revenue <span className="text-[#1d6fe0]">₹{cr(currTotal)} Cr</span></>
              : <>{cur} revenue {totalGrowth >= 0 ? 'up' : 'down'} <span className={totalGrowth >= 0 ? 'text-[#1d6fe0]' : 'text-[#dc2626]'}>{Math.abs(totalGrowth).toFixed(1)}%</span> on {prv}</>}
          </h1>
        </div>
        {picker}
      </header>

      <div className={`grid gap-3 sm:grid-cols-2 ${hasPrev ? 'lg:grid-cols-5' : 'lg:grid-cols-3'}`}>
        {hasPrev && <Kpi tone="green" icon="coins" label={`${prv} ${partial ? `Revenue (${comparedLabel || '—'})` : 'Total Revenue'}`} value={`₹${cr(prevTotal)} Cr`} />}
        <Kpi tone="blue" icon="coins" label={`${cur} ${partial ? 'Revenue so far' : 'Total Revenue'}`} value={`₹${cr(currTotal)} Cr`} />
        {hasPrev && (totalChange !== null
          ? <Kpi tone="orange" icon="bars" label={totalChange >= 0 ? 'Increase (YoY)' : 'Decrease (YoY)'} value={`${totalChange >= 0 ? '+' : '−'} ₹${cr(Math.abs(totalChange))} Cr`} note={totalGrowth !== null ? `(${pct(totalGrowth)})` : undefined} />
          : <Kpi tone="orange" icon="bars" label="Increase (YoY)" value="—" note="No matching quarters" />)}
        {strongest
          ? <Kpi tone="violet" icon="trend" label={(strongest.growth ?? 0) > 0 ? 'Strongest Quarter Growth' : 'Smallest Decline'} value={`Q${strongest.q} ${pct(strongest.growth ?? 0)}`} />
          : !hasPrev
            ? <Kpi tone="violet" icon="trend" label="Best Quarter" value={bestQuarterLabel(rows)} />
            : <Kpi tone="violet" icon="trend" label="Strongest Quarter Growth" value="—" note="No matching quarters" />}
        {hasPrev && (declines.length
          ? <Kpi tone="red" icon="down" label="Largest Decline" value={`Q${declines[0].q} ${pct(declines[0].growth ?? 0)}`} />
          : <Kpi tone="red" icon="down" label="Largest Decline" value="None" note="No quarter fell" />)}
        {!hasPrev && <Kpi tone="green" icon="bars" label="Quarters with data" value={`${present.length} of 4`} />}
      </div>

      <ComparisonChart rows={rows} cur={cur} prv={prv} hasPrev={hasPrev} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <DetailsTable rows={rows} cur={cur} prv={prv} hasPrev={hasPrev} totals={{ prev: prevTotal, curr: currTotal, change: totalChange, growth: totalGrowth, partial }} />
        <Takeaways rows={rows} cur={cur} prv={prv} hasPrev={hasPrev} declines={declines} totalChange={totalChange} totalGrowth={totalGrowth} currTotal={currTotal} />
      </div>
    </div>
  );
}

function bestQuarterLabel(rows: QuarterRow[]) {
  const best = rows.reduce<QuarterRow | null>((b, r) => (r.curr !== null && (b === null || r.curr > (b.curr ?? 0)) ? r : b), null);
  return best ? `Q${best.q} ₹${cr(best.curr ?? 0)} Cr` : '—';
}

/* ---------------------------------------------------------------- chart */

function ComparisonChart({ rows, cur, prv, hasPrev }: { rows: QuarterRow[]; cur: string; prv: string; hasPrev: boolean }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const top = Math.max(...rows.map((r) => Math.max(r.prev ?? 0, r.curr ?? 0)), 0);
    const yMax = niceCeil(top * 1.4 || 1); // headroom for the change badges
    const label = { show: true, position: 'top', distance: 6, color: NAVY, fontWeight: 800, fontSize: 13, formatter: ({ value }: { value: number | null }) => (value ? cr(value) : '') };
    const BAR = 0.26; // bar width as a share of the category band
    const GAP = 0.2; // gap between the pair, as a share of bar width
    const series: unknown[] = [];
    if (hasPrev) series.push({ name: prv, type: 'bar', barWidth: `${BAR * 100}%`, barGap: `${GAP * 100}%`, data: rows.map((r) => r.prev), itemStyle: { color: grad(PREV.top, PREV.bottom), borderRadius: [3, 3, 0, 0] }, label });
    series.push({ name: cur, type: 'bar', barWidth: `${BAR * 100}%`, barGap: `${GAP * 100}%`, data: rows.map((r) => r.curr), itemStyle: { color: grad(CURR.top, CURR.bottom), borderRadius: [3, 3, 0, 0] }, label });
    if (hasPrev) {
      // Change badge and connector arrow drawn between each pair of bars.
      series.push({
        type: 'custom', silent: true, z: 10, tooltip: { show: false },
        data: rows.filter((r) => r.change !== null).map((r) => [r.q - 1, r.prev, r.curr, r.change, r.growth]),
        renderItem: (_params: unknown, api: { value: (i: number) => number; coord: (v: number[]) => number[]; size: (v: number[]) => number[] }) => {
          const idx = api.value(0), prev = api.value(1), curr = api.value(2), change = api.value(3), growth = api.value(4);
          const band = api.size([1, 0])[0];
          const off = (band * BAR * (1 + GAP)) / 2;
          const cx = api.coord([idx, 0])[0];
          const x1 = cx - off, x2 = cx + off;
          const y1 = api.coord([idx, prev])[1] - 24, y2 = api.coord([idx, curr])[1] - 24;
          const c = change >= 0 ? UP : DOWN;
          const yb = Math.min(y1, y2) - 16;
          const boxW = 84, boxH = 40;
          const children: unknown[] = [];
          if (change >= 0) {
            // curved arrow rising from the earlier bar to the later one
            children.push({ type: 'bezierCurve', shape: { x1, y1, cpx1: x1 + (x2 - x1) * 0.15, cpy1: y2 - 4, x2: x2 - 8, y2: y2 + 2 }, style: { stroke: c.line, lineWidth: 2, fill: 'none' } });
            children.push({ type: 'polygon', shape: { points: [[x2 - 2, y2], [x2 - 12, y2 - 5], [x2 - 10, y2 + 6]] }, style: { fill: c.line } });
          } else {
            children.push({ type: 'polyline', shape: { points: [[x1, y1], [x1, yb], [x2, yb], [x2, y2 - 6]] }, style: { stroke: c.line, lineWidth: 2, fill: 'none' } });
            children.push({ type: 'polygon', shape: { points: [[x2, y2], [x2 - 5, y2 - 9], [x2 + 5, y2 - 9]] }, style: { fill: c.line } });
          }
          const by = (change >= 0 ? Math.min(y1, y2) - 10 : yb - 8) - boxH;
          children.push({ type: 'rect', shape: { x: cx - boxW / 2, y: by, width: boxW, height: boxH, r: 7 }, style: { fill: c.bg, stroke: c.border, lineWidth: 1 } });
          children.push({ type: 'text', style: { x: cx, y: by + boxH / 2, text: `${signed(change)} Cr\n(${pct(growth)})`, fill: c.text, font: `800 13px ${FONT}`, align: 'center', verticalAlign: 'middle', lineHeight: 17 } });
          return { type: 'group', children };
        },
      });
    }
    return {
      textStyle: { fontFamily: FONT },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, backgroundColor: '#fff', borderColor: '#e2e8f0', textStyle: { color: NAVY }, valueFormatter: (v: number | null) => (v ? `₹${cr(v)} Cr` : 'No data') },
      grid: { left: 66, right: 24, top: 22, bottom: 52 },
      xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3', 'Q4'], axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 13, fontWeight: 600 }, name: 'Quarter', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: NAVY, fontSize: 13, fontWeight: 600 } },
      yAxis: { type: 'value', min: 0, max: yMax, axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 12 }, splitLine: { lineStyle: { color: '#e2e8f0' } }, name: 'Revenue (₹ Crore)', nameLocation: 'middle', nameGap: 46, nameTextStyle: { color: NAVY, fontSize: 13, fontWeight: 600 } },
      series,
    };
  }, [rows, cur, prv, hasPrev]);

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-[#0b2a6b] via-[#1450b8] to-[#1e88e5] px-5 py-3">
        <h2 className="font-heading text-xl font-bold text-white">Quarterly Revenue Comparison (₹ Crore)</h2>
        <div className="flex items-center gap-5 rounded-lg bg-white px-4 py-1.5 text-sm font-bold text-[#0b1b4d]">
          {hasPrev && <span className="flex items-center gap-2"><span className="h-4 w-6 rounded-sm" style={{ background: `linear-gradient(${PREV.top}, ${PREV.bottom})` }} />{prv}</span>}
          <span className="flex items-center gap-2"><span className="h-4 w-6 rounded-sm" style={{ background: `linear-gradient(${CURR.top}, ${CURR.bottom})` }} />{cur}</span>
        </div>
      </div>
      <div className="h-[360px] px-2 pt-2"><Chart option={option} className="h-full w-full" /></div>
    </section>
  );
}

/* ---------------------------------------------------------------- KPI cards */

type Tone = 'green' | 'blue' | 'orange' | 'violet' | 'red';
const TONES: Record<Tone, { card: string; tile: string; label: string; value: string }> = {
  green: { card: 'border-emerald-300 from-emerald-100 to-emerald-50', tile: 'from-emerald-400 to-emerald-600 text-white shadow-md', label: 'text-emerald-800', value: 'text-emerald-800' },
  blue: { card: 'border-sky-300 from-sky-100 to-blue-50', tile: 'from-sky-400 to-blue-600 text-white shadow-md', label: 'text-blue-800', value: 'text-blue-700' },
  orange: { card: 'border-orange-300 from-orange-100 to-amber-50', tile: 'from-amber-400 to-orange-600 text-white shadow-md', label: 'text-orange-700', value: 'text-orange-600' },
  violet: { card: 'border-violet-300 from-violet-100 to-violet-50', tile: 'from-violet-400 to-violet-700 text-white shadow-md', label: 'text-violet-800', value: 'text-violet-800' },
  red: { card: 'border-rose-300 from-rose-100 to-rose-50', tile: 'from-rose-400 to-rose-600 text-white shadow-md', label: 'text-rose-700', value: 'text-rose-600' },
};

function Kpi({ tone, icon, label, value, note }: { tone: Tone; icon: IconName; label: string; value: string; note?: string }) {
  const t = TONES[tone];
  return (
    <div className={`flex min-h-[96px] min-w-0 items-center gap-3 rounded-2xl border bg-gradient-to-br px-3 py-3 shadow-sm ${t.card}`}>
      <span className={`hidden h-12 w-12 shrink-0 place-items-center rounded-full sm:grid lg:hidden 2xl:grid bg-gradient-to-br ${t.tile}`}><Icon name={icon} /></span>
      <div className="@container min-w-0 flex-1 text-center">
        <div className={`text-sm font-semibold leading-tight ${t.label}`}>{label}</div>
        <div className={`mt-0.5 whitespace-nowrap font-heading text-[clamp(15px,13cqi,24px)] font-extrabold leading-tight ${t.value}`}>{value}</div>
        {note && <div className={`text-sm font-semibold ${t.value}`}>{note}</div>}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- details table */

function DetailsTable({ rows, cur, prv, hasPrev, totals }: { rows: QuarterRow[]; cur: string; prv: string; hasPrev: boolean; totals: { prev: number; curr: number; change: number | null; growth: number | null; partial: boolean } }) {
  const tone = (v: number | null) => (v === null ? '' : v >= 0 ? 'text-[#15803d]' : 'text-[#dc2626]');
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-bold text-[#0b1b4d]"><span className="text-[#2563eb]"><Icon name="bars" size={20} /></span>Quarterly Revenue Details (₹ Crore)</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-center text-sm">
          <thead>
            <tr className="text-[13px] font-semibold leading-tight text-white">
              <th className="bg-[#123a8c] px-3 py-2">Quarter</th>
              {hasPrev && <th className="bg-[#0e9aa7] px-3 py-2">{prv} Revenue<br />(₹ Cr)</th>}
              <th className="bg-[#2563eb] px-3 py-2">{cur} Revenue<br />(₹ Cr)</th>
              {hasPrev && <th className="bg-[#f97316] px-3 py-2">Change<br />(₹ Cr)</th>}
              {hasPrev && <th className="bg-[#7c3aed] px-3 py-2">YoY Growth<br />(%)</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.q} className="border-t border-slate-200 text-[#0b1b4d] odd:bg-white even:bg-[#f4f8fd]">
                <td className="whitespace-nowrap px-3 py-1.5 font-bold">Q{r.q} ({QUARTER_MONTHS[r.q - 1]})</td>
                {hasPrev && <td className="px-3 py-1.5 tabular-nums">{r.prev === null ? '–' : cr(r.prev)}</td>}
                <td className="px-3 py-1.5 tabular-nums">{r.curr === null ? '–' : cr(r.curr)}</td>
                {hasPrev && <td className={`px-3 py-1.5 font-semibold tabular-nums ${tone(r.change)}`}>{r.change === null ? '–' : signed(r.change)}</td>}
                {hasPrev && <td className={`px-3 py-1.5 font-semibold tabular-nums ${tone(r.growth)}`}>{r.growth === null ? '–' : pct(r.growth)}</td>}
              </tr>
            ))}
            <tr className="border-t border-emerald-200 bg-[#e3f8ee] text-[15px] font-extrabold text-[#0b1b4d]">
              <td className="px-3 py-2">{totals.partial ? 'Total (uploaded)' : 'Total (Q1–Q4)'}</td>
              {hasPrev && <td className="px-3 py-2 tabular-nums">{cr(totals.prev)}</td>}
              <td className="px-3 py-2 tabular-nums">{cr(totals.curr)}</td>
              {hasPrev && <td className={`px-3 py-2 tabular-nums ${tone(totals.change)}`}>{totals.change === null ? '–' : signed(totals.change)}</td>}
              {hasPrev && <td className={`px-3 py-2 tabular-nums ${tone(totals.growth)}`}>{totals.growth === null ? '–' : pct(totals.growth)}</td>}
            </tr>
          </tbody>
        </table>
      </div>
      {totals.partial && hasPrev && <p className="mt-2 text-xs text-[#475569]">Totals, change and growth cover only the quarters that have {cur} data.</p>}
    </section>
  );
}

/* ---------------------------------------------------------------- takeaways */

const BULLETS = ['#2563eb', '#16a34a', '#f97316', '#7c3aed', '#ec4899', '#0e9aa7'];

function Takeaways({ rows, cur, prv, hasPrev, declines, totalChange, totalGrowth, currTotal }: { rows: QuarterRow[]; cur: string; prv: string; hasPrev: boolean; declines: QuarterRow[]; totalChange: number | null; totalGrowth: number | null; currTotal: number }) {
  const items: ReactNode[] = [];
  const best = rows.reduce<QuarterRow | null>((b, r) => (r.curr !== null && (b === null || r.curr > (b.curr ?? 0)) ? r : b), null);
  if (best) items.push(<>Q{best.q} has the highest revenue at <b>₹{cr(best.curr ?? 0)} Cr</b>{best.growth !== null ? <>, with a {best.growth >= 0 ? 'growth' : 'change'} of <b>{pct(best.growth)}</b></> : null}.</>);
  declines.forEach((d, i) => items.push(<>Q{d.q} {i > 0 ? 'also ' : ''}saw a decline of <b className="text-[#dc2626]">₹{cr(Math.abs(d.change ?? 0))} Cr ({pct(d.growth ?? 0)})</b> compared to Q{d.q} {prv}.</>));
  if (hasPrev) {
    for (const [name, span, qs] of [['H1', 'Apr – Sep', [1, 2]], ['H2', 'Oct – Mar', [3, 4]]] as const) {
      const half = rows.filter((r) => (qs as readonly number[]).includes(r.q));
      if (half.every((r) => r.curr !== null && r.prev !== null)) {
        const c = sum(half.map((r) => r.curr)), p = sum(half.map((r) => r.prev));
        const g = p ? ((c - p) / p) * 100 : 0;
        items.push(<>{name} {cur} ({span}) totals <b>₹{cr(c)} Cr</b>, {g >= 0 ? 'up' : 'down'} <b>{Math.abs(g).toFixed(1)}%</b> vs {name} {prv} (₹{cr(p)} Cr).</>);
      }
    }
  }
  if (totalChange !== null && totalGrowth !== null) {
    const recovery = rows[3].growth !== null && rows[3].growth > 10 ? ', with strong recovery in Q4' : '';
    items.push(<>Overall {cur} revenue {totalChange >= 0 ? 'increased' : 'decreased'} by <b>{Math.abs(totalGrowth).toFixed(1)}% (₹{cr(Math.abs(totalChange))} Cr)</b> compared to {prv}{recovery}.</>);
  } else {
    items.push(<>{cur} revenue so far is <b>₹{cr(currTotal)} Cr</b>{hasPrev ? '' : `; upload ${prv} data to see the year-on-year comparison`}.</>);
  }
  return (
    <section className="rounded-2xl border border-sky-100 bg-gradient-to-br from-[#eef6ff] to-[#f6fbff] p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 font-heading text-lg font-bold text-[#0b1b4d]"><span aria-hidden="true">💡</span>Key Takeaways</h2>
      <ol className="space-y-2.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-3 text-[14.5px] leading-snug text-[#0b1b4d]">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold text-white" style={{ background: BULLETS[i % BULLETS.length] }}>{i + 1}</span>
            <span>{t}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------------------------------------------------------------- helpers */

function grad(top: string, bottom: string) {
  return { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: top }, { offset: 1, color: bottom }] };
}
function niceCeil(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const step = [0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => Math.ceil(v / s) <= 10) ?? p * 10;
  return Math.ceil(v / step) * step;
}

type IconName = 'coins' | 'bars' | 'trend' | 'down';
function Icon({ name, size = 28 }: { name: IconName; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  switch (name) {
    case 'coins': return <svg {...p}><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" /></svg>;
    case 'bars': return <svg {...p}><path d="M5 20v-6M10 20V10M15 20V7M20 20V4" /></svg>;
    case 'trend': return <svg {...p}><path d="M3 18l6-6 4 4 8-8m0 0h-5m5 0v5" /></svg>;
    case 'down': return <svg {...p}><path d="M3 6l6 6 4-4 8 8m0 0v-5m0 5h-5" /></svg>;
  }
}

/* The reference sample (FY24 vs FY25), used by tests and for design checks. */
export const SAMPLE_MODEL = buildModel(2024, [110, 150, 95, 165].map((v) => v * CRORE), [120, 140, 100, 130].map((v) => v * CRORE));
