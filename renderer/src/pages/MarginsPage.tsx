import { useEffect, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { ApiError, peekReportCache } from '../api/client';
import { reportApi, type MarginYear } from '../api/data';
import { Chart } from '../components/Chart';
import { fyShort } from '../components/FyPicker';

/* ------------------------------------------------------------------ palette */
const NAVY = '#0b1b4d';
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
const REV = { top: '#a9cdfa', bottom: '#6aa8f2' };
const PAT = { top: '#1d3f8f', bottom: '#0b2a6b' };
const GROSS = '#0b2a6b';
const OPER = '#14a38b';
const CRORE = 1_000_000_000;
const STALE = '__stale_backend__';

/* -------------------------------------------------------------------- model */

export interface Row {
  fy: number; label: string; partial: boolean;
  revenue: number; gross: number | null; ebitda: number | null; operating: number | null; pat: number | null;
  grossM: number | null; opM: number | null; patM: number | null;
}

export function buildRows(years: MarginYear[]): Row[] {
  return years.slice(-6).map((y) => {
    const p = y.pnl;
    const revenue = p?.revenue ?? y.sales_paise;
    const gross = p && p.revenue !== undefined ? revenue - (p.cogs ?? 0) : null;
    const ebitda = gross !== null && p ? gross - (p.opex ?? 0) : null;
    const operating = ebitda !== null && p ? ebitda - (p.depreciation_amortisation ?? 0) : null;
    const pat = p ? (p.net_income ?? (operating !== null ? operating - (p.interest ?? 0) - (p.tax ?? 0) : null)) : null;
    const m = (x: number | null) => (x === null || !revenue ? null : (x * 100) / revenue);
    return {
      fy: y.fy, label: fyShort(y.fy), partial: !p && y.sales_months < 12,
      revenue, gross, ebitda, operating, pat, grossM: m(gross), opM: m(operating), patM: m(pat),
    };
  });
}

const num = (paise: number | null) => (paise === null ? null : (paise / CRORE).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(paise / CRORE) >= 100 ? 0 : 2 }));
const cr = (paise: number | null) => (paise === null ? '—' : `₹${num(paise)} Cr`);
const pctTxt = (v: number | null, d = 1) => (v === null ? '—' : `${v.toFixed(d)}%`);
const signedPct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const growth = (a: number | null, b: number | null) => (a === null || b === null || !b ? null : ((a - b) / Math.abs(b)) * 100);
function cagr(rows: Row[], pick: (r: Row) => number | null) {
  const full = rows.filter((r) => !r.partial && pick(r) !== null && (pick(r) ?? 0) > 0);
  if (full.length < 2) return null;
  const a = full[0], b = full[full.length - 1];
  return (Math.pow((pick(b) as number) / (pick(a) as number), 1 / (b.fy - a.fy)) - 1) * 100;
}

/* ---------------------------------------------------------------- page */

export function MarginsPage() {
  const [years, setYears] = useState<MarginYear[] | null>(() => peekReportCache<{ years: MarginYear[] }>('/api/reports/margins')?.years ?? null);
  const [error, setError] = useState('');
  useEffect(() => {
    void reportApi.margins().then((r) => setYears(r.years)).catch((e: Error) => setError(e instanceof ApiError && e.status === 404 ? STALE : e.message));
  }, []);
  if (error) return <Notice tone="error">{error === STALE ? 'Margins: the data service is out of date. Close the app completely and start it again.' : error}</Notice>;
  if (!years) return null;
  if (!years.length) return <Notice>Margins: no sales or Profit & Loss data is available yet.</Notice>;
  return <MarginsView years={years} />;
}

function Notice({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return <div className={`rounded-2xl border bg-white p-8 text-center ${tone === 'error' ? 'border-rose-200 text-rose-600' : 'border-sky-200 text-muted'}`}>{children}</div>;
}

export function MarginsView({ years }: { years: MarginYear[] }) {
  const rows = buildRows(years);
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const withPat = rows.filter((r) => r.patM !== null);
  const hasPnl = withPat.length > 0;
  const m0 = withPat[0], m1 = withPat[withPat.length - 1];
  const marginRows = rows.filter((r) => r.grossM !== null).slice(-4);

  return (
    <div className="relative min-w-0 space-y-3">
      <header className="space-y-4">
        <div className="min-w-0">
          <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#0e9a6e]">Margins <span className="mx-2 text-[#94a3b8]">|</span> Profitability Trend</div>
          <h1 className="mt-1 font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d]">
            {hasPnl && m0 !== m1
              ? <>Profit margin <span className={(m1.patM ?? 0) >= (m0.patM ?? 0) ? 'text-[#1d6fe0]' : 'text-rose-600'}>{(m1.patM ?? 0) >= (m0.patM ?? 0) ? 'improved' : 'declined'}</span> from {pctTxt(m0.patM)} in {m0.label} to {pctTxt(m1.patM)} in {m1.label}</>
              : hasPnl ? <>Profit margin {pctTxt(m1.patM)} in {m1.label}</>
              : <>Profitability trend <span className="text-[#1d6fe0]">awaiting P&amp;L data</span></>}
          </h1>
        </div>
        {/* Summary cards sit in one row under the title. */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <TopCard tone="blue" icon={<CoinsIcon />} label={`Revenue (${last.label}${last.partial ? ' YTD' : ''})`} value={cr(last.revenue)} change={last.partial ? null : growth(last.revenue, prev?.revenue ?? null)} vs={prev ? `vs ${prev.label}` : undefined} />
          <TopCard tone="violet" icon={<CoinsIcon />} label={`EBITDA (${last.label})`} value={cr(last.ebitda)} change={growth(last.ebitda, prev?.ebitda ?? null)} vs={prev ? `vs ${prev.label}` : undefined} />
          <TopCard tone="green" icon={<BarsIcon size={28} />} label={`PAT (${last.label})`} value={cr(last.pat)} change={growth(last.pat, prev?.pat ?? null)} vs={prev ? `vs ${prev.label}` : undefined} />
          <TopCard tone="orange" icon={<span className="text-2xl font-extrabold">%</span>} label={`Profit Margin (${last.label})`} value={pctTxt(last.patM)}
            change={m0 && last.patM !== null && m0 !== last ? (last.patM - (m0.patM ?? 0)) : null} unit="pp" vs={m0 && m0 !== last ? `vs ${m0.label}` : undefined} />
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1.1fr]">
        <Panel title="Profit Margin Trend (%)">
          <Legend items={[['Revenue (₹ Cr)', REV.bottom, 'bar'], ['PAT (₹ Cr)', PAT.bottom, 'bar'], ['Profit Margin (%)', '#1d4ed8', 'line']]} />
          <TrendChart rows={rows} line="#1d4ed8" hasPnl={hasPnl} />
          <div className="mx-2 mt-1 flex items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-[#eef4ff] px-3 py-3 text-[13px] font-semibold text-[#0b1b4d]">
            <span className="text-[#1d6fe0]"><CalcIcon /></span>
            Profit Margin (%) =
            <span className="inline-flex flex-col items-center leading-tight"><span className="border-b border-[#0b1b4d] px-2">PAT (₹ Cr)</span><span className="px-2">Revenue (₹ Cr)</span></span>
            × 100
          </div>
        </Panel>
        <Panel title="Gross vs Operating Margin (%)">
          <Legend items={[['Gross Margin % (Gross Profit ₹ Cr)', GROSS, 'bar'], ['Operating Margin % (Operating Profit ₹ Cr)', OPER, 'bar']]} />
          {marginRows.length ? <GrossOpChart rows={marginRows} /> : <Awaiting h="h-[330px]" what="Gross and operating margins" fields="Revenue, Cost of goods sold, Operating expenses, Depreciation & amortisation" />}
        </Panel>
        <Panel title="Revenue, PAT and Profit Margin Trend">
          <Legend items={[['Revenue (₹ Cr)', REV.bottom, 'bar'], ['PAT (₹ Cr)', PAT.bottom, 'bar'], ['Profit Margin (%)', '#f59e0b', 'line']]} />
          <TrendChart rows={rows} line="#f59e0b" hasPnl={hasPnl} tall />
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_1.1fr]">
        <Card title="Profitability Details (₹ Cr)" icon={<BarsIcon />}>
          <Table head={[['Year', '#0b2a6b'], ['Revenue\n(₹ Cr)', '#1d6fe0'], ['Gross Profit\n(₹ Cr)', '#0e9a6e'], ['Operating Profit\n(₹ Cr)', '#f59e0b'], ['PAT\n(₹ Cr)', '#7c3aed'], ['Profit Margin\n(%)', '#0b2a6b']]}
            rows={rows.map((r) => [yearLabel(r), num(r.revenue), num(r.gross), num(r.operating), num(r.pat), r.patM === null ? null : `${r.patM.toFixed(1)}%`])}
            foot={[`CAGR\n(${cagrSpan(rows)})`, pctOrNull(cagr(rows, (r) => r.revenue)), pctOrNull(cagr(rows, (r) => r.gross)), pctOrNull(cagr(rows, (r) => r.operating)), pctOrNull(cagr(rows, (r) => r.pat)),
              m0 && m1 && m0 !== m1 ? `${(m1.patM ?? 0) - (m0.patM ?? 0) >= 0 ? '+' : '−'}${Math.abs((m1.patM ?? 0) - (m0.patM ?? 0)).toFixed(1)} pp` : null]} />
        </Card>
        <Card title="Margin Details (%)" icon={<span className="grid h-6 w-6 place-items-center rounded-full bg-[#1d6fe0] text-sm font-extrabold text-white">%</span>}>
          {marginRows.length ? (
            <Table head={[['Year', '#0b2a6b'], ['Gross\nMargin %', '#1d6fe0'], ['Gross Profit\n(₹ Cr)', '#0e9a6e'], ['Operating\nMargin %', '#14a38b'], ['Operating Profit\n(₹ Cr)', '#f59e0b']]}
              rows={marginRows.map((r) => [r.label, pctTxt(r.grossM), num(r.gross), pctTxt(r.opM), num(r.operating)])}
              foot={[`Increase\n(${marginRows[0].label}–${marginRows[marginRows.length - 1].label})`,
                pp(marginRows[0].grossM, marginRows[marginRows.length - 1].grossM), diff(marginRows[0].gross, marginRows[marginRows.length - 1].gross),
                pp(marginRows[0].opM, marginRows[marginRows.length - 1].opM), diff(marginRows[0].operating, marginRows[marginRows.length - 1].operating)]} />
          ) : (
            <Table head={[['Year', '#0b2a6b'], ['Gross\nMargin %', '#1d6fe0'], ['Gross Profit\n(₹ Cr)', '#0e9a6e'], ['Operating\nMargin %', '#14a38b'], ['Operating Profit\n(₹ Cr)', '#f59e0b']]}
              rows={rows.slice(-4).map((r) => [r.label, null, null, null, null])} foot={['Increase', null, null, null, null]} />
          )}
        </Card>
        <Card title="Year-on-Year Growth (₹ Cr and %)" icon={<BarsIcon />}>
          <Table head={[['Year', '#0b2a6b'], ['Revenue\n(₹ Cr)', '#1d6fe0'], ['YoY %', '#14a38b'], ['PAT\n(₹ Cr)', '#7c3aed'], ['YoY %', '#14a38b']]}
            rows={rows.map((r, i) => {
              const g = i > 0 && !r.partial ? growth(r.revenue, rows[i - 1].revenue) : null;
              const gp = i > 0 ? growth(r.pat, rows[i - 1].pat) : null;
              return [yearLabel(r), num(r.revenue), i === 0 ? '–' : g === null ? null : { t: signedPct(g), up: g >= 0 }, num(r.pat), i === 0 ? '–' : gp === null ? null : { t: signedPct(gp), up: gp >= 0 }];
            })}
            foot={[`CAGR\n(${cagrSpan(rows)})`, pctOrNull(cagr(rows, (r) => r.revenue)), '', pctOrNull(cagr(rows, (r) => r.pat)), '']} />
        </Card>
      </div>
      {!hasPnl && <p className="text-xs text-[#64748b]">“—” marks figures that need a Profit and loss upload. Revenue comes from the Sales Register until P&amp;L revenue is uploaded; YTD years are part-years.</p>}
    </div>
  );
}

const yearLabel = (r: Row) => `${r.label}${r.partial ? ' (YTD)' : ''}`;
const pctOrNull = (v: number | null) => (v === null ? null : `${v.toFixed(1)}%`);
const pp = (a: number | null, b: number | null) => (a === null || b === null ? null : `${b - a >= 0 ? '+' : '−'}${Math.abs(b - a).toFixed(1)} pp`);
const diff = (a: number | null, b: number | null) => (a === null || b === null ? null : `${b - a >= 0 ? '+' : '−'}${num(Math.abs(b - a))}`);
function cagrSpan(rows: Row[]) {
  const full = rows.filter((r) => !r.partial);
  return full.length > 1 ? `${full[0].label}–${full[full.length - 1].label}` : '—';
}

/* ---------------------------------------------------------------- charts */

const grad = (g: { top: string; bottom: string }) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: g.top }, { offset: 1, color: g.bottom }] });
const v = (p: number | null) => (p === null ? null : Number((p / CRORE).toFixed(2)));
const fmtCr = (x: number) => x.toLocaleString('en-IN', { maximumFractionDigits: x >= 100 ? 0 : 2 });

function TrendChart({ rows, line, hasPnl, tall = false }: { rows: Row[]; line: string; hasPnl: boolean; tall?: boolean }) {
  const option: EChartsCoreOption = {
    textStyle: { fontFamily: FONT },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    grid: { left: 58, right: 50, top: 28, bottom: 30 },
    xAxis: { type: 'category', data: rows.map((r) => r.label), axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 13 } },
    yAxis: [
      { type: 'value', name: 'Amount (₹ Cr)', nameLocation: 'middle', nameGap: 44, nameTextStyle: { color: NAVY, fontWeight: 700 }, axisLabel: { color: NAVY }, axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, splitLine: { lineStyle: { color: '#e8edf4' } } },
      { type: 'value', min: 0, max: 20, interval: 5, name: 'Profit Margin (%)', nameLocation: 'middle', nameGap: 36, nameTextStyle: { color: NAVY, fontWeight: 700 }, axisLabel: { color: NAVY, formatter: '{value}%' }, splitLine: { show: false } },
    ],
    series: [
      { name: 'Revenue (₹ Cr)', type: 'bar', barGap: '-35%', barWidth: '42%', data: rows.map((r) => v(r.revenue)), itemStyle: { color: grad(REV), borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top', color: NAVY, fontWeight: 800, fontSize: 12, formatter: ({ value }: { value: number }) => fmtCr(value) } },
      { name: 'PAT (₹ Cr)', type: 'bar', barWidth: '28%', data: rows.map((r) => v(r.pat)), itemStyle: { color: grad(PAT), borderRadius: [3, 3, 0, 0] },
        label: { show: true, position: 'top', color: NAVY, fontWeight: 800, fontSize: 12, formatter: ({ value }: { value: number }) => fmtCr(value) } },
      { name: 'Profit Margin (%)', type: 'line', yAxisIndex: 1, data: rows.map((r) => (r.patM === null ? null : Number(r.patM.toFixed(1)))), symbol: 'circle', symbolSize: 10,
        lineStyle: { color: line, width: 3 }, itemStyle: { color: line, borderColor: '#fff', borderWidth: 2 },
        label: { show: true, position: 'top', color: line === '#f59e0b' ? '#b45309' : '#1d4ed8', fontWeight: 800, fontSize: 12, padding: [2, 5], borderRadius: 4, backgroundColor: line === '#f59e0b' ? '#fff7e0' : '#eaf2ff', formatter: '{c}%' } },
    ],
  };
  return (
    <div className={`relative ${tall ? 'h-[330px]' : 'h-[270px]'}`}>
      <Chart option={option} className="h-full w-full" />
      {!hasPnl && <span className="pointer-events-none absolute right-14 top-3 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">PAT &amp; margin: awaiting P&amp;L upload</span>}
    </div>
  );
}

function GrossOpChart({ rows }: { rows: Row[] }) {
  const option: EChartsCoreOption = {
    textStyle: { fontFamily: FONT },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (x: number) => `${x}%` },
    grid: { left: 46, right: 12, top: 50, bottom: 30 },
    xAxis: { type: 'category', data: rows.map((r) => r.label), axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 13 } },
    yAxis: { type: 'value', min: 0, axisLabel: { color: NAVY, formatter: '{value}%' }, axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, splitLine: { lineStyle: { color: '#e8edf4' } } },
    series: [
      { name: 'Gross Margin', type: 'bar', barGap: '10%', barWidth: '34%', itemStyle: { color: GROSS, borderRadius: [3, 3, 0, 0] },
        data: rows.map((r) => ({ value: Number((r.grossM ?? 0).toFixed(1)), profit: r.gross })),
        label: { show: true, position: 'top', lineHeight: 15, formatter: (p: { value: number; data: { profit: number } }) => `{a|${p.value}%}\n{b|₹${num(p.data.profit)} Cr}`, rich: { a: { color: NAVY, fontWeight: 800, fontSize: 13 }, b: { color: NAVY, fontSize: 11 } } } },
      { name: 'Operating Margin', type: 'bar', barWidth: '34%', itemStyle: { color: OPER, borderRadius: [3, 3, 0, 0] },
        data: rows.map((r) => ({ value: Number((r.opM ?? 0).toFixed(1)), profit: r.operating })),
        label: { show: true, position: 'top', lineHeight: 15, formatter: (p: { value: number; data: { profit: number } }) => `{a|${p.value}%}\n{b|₹${num(p.data.profit)} Cr}`, rich: { a: { color: NAVY, fontWeight: 800, fontSize: 13 }, b: { color: OPER, fontSize: 11, fontWeight: 700 } } } },
    ],
  };
  return <div className="h-[330px]"><Chart option={option} className="h-full w-full" /></div>;
}

function Awaiting({ what, fields, h }: { what: string; fields: string; h: string }) {
  return (
    <div className={`mx-2 mb-2 grid place-items-center rounded-xl border-2 border-dashed border-sky-200 bg-gradient-to-br from-[#f4f8ff] to-[#f0faf6] px-6 text-center ${h}`}>
      <div>
        <div className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-[#e3eeff] text-[#1d6fe0]"><BarsIcon size={28} /></div>
        <div className="font-heading text-lg font-bold text-[#0b1b4d]">{what} need Profit &amp; Loss data</div>
        <div className="mt-1 text-sm text-[#475569]">Upload a <b>Profit and loss</b> file with: {fields} (₹, per year).</div>
      </div>
    </div>
  );
}

function Legend({ items }: { items: [string, string, 'bar' | 'line'][] }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-6 gap-y-1 px-4 pt-3 text-sm text-[#0b1b4d]">
      {items.map(([label, color, kind]) => (
        <span key={label} className="flex items-center gap-1.5">
          {kind === 'bar' ? <span className="h-3.5 w-3.5 rounded-sm" style={{ background: color }} />
            : <span className="relative h-0.5 w-6" style={{ background: color }}><span className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: color }} /></span>}
          {label}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- tables, cards, frames */

type Cell = string | null | { t: string; up: boolean };

function Table({ head, rows, foot }: { head: [string, string][]; rows: Cell[][]; foot: Cell[] }) {
  const show = (c: Cell) => (c === null ? <span className="text-[#cbd5e1]">—</span> : typeof c === 'string' ? c : <span className={`font-semibold ${c.up ? 'text-emerald-600' : 'text-rose-600'}`}>{c.t}</span>);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full table-fixed border-collapse text-center text-[12.5px] text-[#0b1b4d]">
        <thead><tr>{head.map(([h, bg]) => <th key={h} className="whitespace-pre-line break-words px-1 py-2 text-[11.5px] font-semibold leading-tight text-white" style={{ background: bg }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]">{r.map((c, j) => <td key={j} className="break-words px-1 py-1.5 tabular-nums">{show(c)}</td>)}</tr>)}
          <tr className="border-t-2 border-emerald-200 bg-[#dcf5ea] font-extrabold">
            {foot.map((c, j) => <td key={j} className={`whitespace-pre-line break-words px-1 py-2 tabular-nums ${j === 0 ? 'text-[11px] leading-tight' : 'text-[13.5px]'}`}>{show(c)}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

const TOP = {
  blue: { card: 'border-sky-300 from-sky-100 to-blue-50', tile: 'bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-md', label: 'text-[#1d6fe0]', value: 'text-[#1d4ed8]' },
  violet: { card: 'border-violet-300 from-violet-100 to-violet-50', tile: 'bg-gradient-to-br from-violet-400 to-violet-700 text-white shadow-md', label: 'text-[#7c3aed]', value: 'text-[#6d28d9]' },
  green: { card: 'border-emerald-300 from-emerald-100 to-emerald-50', tile: 'bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-md', label: 'text-[#0b1b4d]', value: 'text-[#0b1b4d]' },
  orange: { card: 'border-orange-300 from-orange-100 to-amber-50', tile: 'bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-md', label: 'text-[#9a3412]', value: 'text-[#0b1b4d]' },
};

function TopCard({ tone, icon, label, value, change, vs, unit = '%' }: { tone: keyof typeof TOP; icon: ReactNode; label: string; value: string; change: number | null; vs?: string; unit?: '%' | 'pp' }) {
  const s = TOP[tone];
  const empty = value === '—';
  return (
    <div className={`flex min-w-0 items-center gap-4 rounded-2xl border bg-gradient-to-br px-4 py-3 shadow-sm ${s.card}`}>
      <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-full ${s.tile}`}>{icon}</span>
      <div className="min-w-0">
        <div className={`text-[13px] font-semibold ${s.label}`}>{label}</div>
        <div className={`whitespace-nowrap font-heading text-2xl font-extrabold leading-tight ${empty ? 'text-[#cbd5e1]' : s.value}`}>{value}</div>
        {empty ? <div className="text-xs font-semibold text-amber-700">Needs P&amp;L upload</div>
          : change !== null ? <div className={`text-sm font-bold ${change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{change >= 0 ? '▲' : '▼'} {unit === 'pp' ? `${change >= 0 ? '+' : '−'}${Math.abs(change).toFixed(1)} pp` : signedPct(change)}</div> : null}
        {!empty && vs && change !== null && <div className="text-xs text-[#334155]">{vs}</div>}
      </div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_4px_20px_rgba(15,40,90,0.06)]">
      <div className="bg-gradient-to-r from-[#0b2a6b] via-[#1450b8] to-[#1e88e5] px-5 py-3"><h2 className="font-heading text-lg font-bold text-white">{title}</h2></div>
      <div className="pb-3">{children}</div>
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

function BarsIcon({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="12" width="4.5" height="9" rx="1" /><rect x="9.75" y="7" width="4.5" height="14" rx="1" /><rect x="16.5" y="3" width="4.5" height="18" rx="1" /></svg>; }
function CoinsIcon() { return <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="2.6" /><path d="M5 6v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4M5 14v4c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4" /></svg>; }
function CalcIcon() { return <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2.5" /><rect x="7" y="5" width="10" height="4" rx="1" fill="#fff" /><g fill="#fff"><circle cx="8.5" cy="13" r="1.1" /><circle cx="12" cy="13" r="1.1" /><circle cx="15.5" cy="13" r="1.1" /><circle cx="8.5" cy="17" r="1.1" /><circle cx="12" cy="17" r="1.1" /><circle cx="15.5" cy="17" r="1.1" /></g></svg>; }

/* The reference design's figures (FY20–FY25), used by tests and design checks. */
const c = (x: number) => x * CRORE;
export const SAMPLE_MARGINS: MarginYear[] = [
  [2019, 1980, 554, 356, 180], [2020, 2150, 624, 408, 220], [2021, 2420, 718, 510, 276],
  [2022, 2680, 858, 612, 346], [2023, 2660, 910, 664, 368], [2024, 3050, 1037, 732, 461],
].map(([fy, rev, gp, op, pat]) => ({
  fy, sales_paise: c(rev), sales_months: 12,
  pnl: { revenue: c(rev), cogs: c(rev - gp), opex: c(gp - op), depreciation_amortisation: 0, net_income: c(pat) },
}));
