import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { ApiError, peekReportCache } from '../api/client';
import { reportApi, type RegionSummary, type ZoneSales } from '../api/data';
import { Chart } from '../components/Chart';
import { FyPicker, fyShort } from '../components/FyPicker';

// A 404 means the running backend predates this report (it was not restarted after an update).
const STALE = '__stale_backend__';

/* ------------------------------------------------------------------ palette */
const NAVY = '#0b1b4d';
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
export const ZONE_COLORS: Record<string, string> = { North: '#0d3a8a', South: '#14a38b', East: '#f6b707', West: '#4da3f0', Unassigned: '#94a3b8' };
const ZONE_TOPS: Record<string, string> = { North: '#1d4fa8', South: '#2cc3a6', East: '#ffd04a', West: '#7cc0fa', Unassigned: '#b8c2cf' };
const HEADER_COLORS: Record<string, string> = { North: '#1d4ed8', South: '#0f9b84', East: '#f2a900', West: '#3b9cf0', Unassigned: '#94a3b8' };
const PREV_BAR = '#c5ccd6';
const CRORE = 1_000_000_000;

const cr = (paise: number) => {
  const v = paise / CRORE;
  const digits = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  return v.toLocaleString('en-IN', { maximumFractionDigits: digits });
};
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const growth = (curr: number, prev: number) => (prev > 0 ? ((curr - prev) / prev) * 100 : null);

/* ---------------------------------------------------------------- component */

export function RegionPage() {
  const [data, setData] = useState<RegionSummary | null>(() => peekReportCache('/api/reports/region-summary') ?? null);
  const [error, setError] = useState('');
  const [fy, setFy] = useState<number | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void reportApi.regionSummary(fy).then((r) => live && setData(r)).catch((e: Error) => live && setError(e instanceof ApiError && e.status === 404 ? STALE : e.message));
    return () => { live = false; };
  }, [fy]);
  if (error) {
    const stale = error === STALE;
    return <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center text-rose-600">{stale ? 'The data service is out of date and does not provide regional sales yet. Close the app completely and start it again.' : error}</div>;
  }
  if (!data) return null;
  if (data.fy === null || !data.zones.length) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">No sales data is available. Upload and import a Sales Register file to populate this page.</div>;
  return (
    <div>
      <RegionView data={data} picker={<FyPicker fy={data.fy} years={data.available_fys} onChange={setFy} />} />
    </div>
  );
}

export function RegionView({ data, picker }: { data: RegionSummary; picker?: ReactNode }) {
  const fy = data.fy ?? 0;
  const cur = fyShort(fy);
  const prv = fyShort(fy - 1);
  // The four regions only; sales without a state code are reported separately.
  const zones = data.zones.filter((z) => z.zone !== 'Unassigned');
  const previous = data.previous?.filter((z) => z.zone !== 'Unassigned') ?? null;
  const total = zones.reduce((a, z) => a + z.total_paise, 0);
  const named = zones.filter((z) => z.zone !== 'Unassigned' && z.total_paise > 0);
  const ranked = [...named].sort((a, b) => b.total_paise - a.total_paise);
  const top = ranked[0];
  const share = (z: ZoneSales) => (total ? (z.total_paise * 100) / total : 0);

  // Year-on-year: compare like for like on the quarters this year has data for.
  const present = [0, 1, 2, 3].filter((q) => data.zones.some((z) => z.quarters[q] > 0));
  const partial = present.length < 4;
  const prevZone = (name: string) => previous?.find((z) => z.zone === name);
  const like = (z: ZoneSales | undefined) => (z ? present.reduce((a, q) => a + z.quarters[q], 0) : 0);
  const prevTotal = previous ? previous.reduce((a, z) => a + like(z), 0) : 0;
  const quarterTotals = [0, 1, 2, 3].map((q) => zones.reduce((a, z) => a + z.quarters[q], 0));
  const prevQuarterTotals = [0, 1, 2, 3].map((q) => (previous ?? []).reduce((a, z) => a + z.quarters[q], 0));
  const bestQ = present.reduce((b, q) => (quarterTotals[q] > quarterTotals[b] ? q : b), present[0] ?? 0);
  const lowest = ranked[ranked.length - 1];
  const quarterLabel = present.map((q) => `Q${q + 1}`).join(', ');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#0e9aa7]">Sales <span className="mx-2 text-[#94a3b8]">|</span> Region wise</div>
          <h1 className="mt-1 font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d]">
            Strong global presence drives sales <span className="text-[#1d6fe0]">in {cur}</span>
          </h1>
        </div>
        {picker}
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <Card title={`Sales by Region and Quarter (₹ Cr) – ${cur}`} icon={<BarsIcon />} banner>
          <QuarterChart key={fy} zones={zones} />
        </Card>
        <Card title={`Sales by Region (Share %) – ${cur}`} icon={<PieIcon />} banner>
          <ShareDonut key={fy} zones={zones} total={total} cur={cur} />
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.85fr)_minmax(0,1fr)]">
        <Card title={`Quarter-wise Regional Sales Details (₹ Cr) – ${cur}`} icon={<BarsIcon />}>
          <DetailsTable zones={zones} quarterTotals={quarterTotals} total={total} cur={cur} />
        </Card>
        <Card title="Year-on-Year Sales Comparison (₹ Cr)" icon={<CalendarIcon />}>
          {previous
            ? <YoyChart key={fy} prev={prevTotal} curr={total} cur={cur} prv={prv} note={partial ? `Same quarters only (${quarterLabel})` : undefined} />
            : <p className="py-10 text-center text-sm text-[#475569]">No {prv} data uploaded yet, so there is nothing to compare against.</p>}
        </Card>
        <Card title={data.previous ? `Key Highlights (${cur} vs ${prv})` : `Key Highlights (${cur})`} icon={<BarsIcon />}>
          <div className="space-y-2">
            <Highlight tone="green" icon={<BarsIcon size={24} />} label="Total Sales" value={`₹${cr(total)} Cr`} change={data.previous ? growth(total, prevTotal) : null} vs={data.previous ? `vs ${prv} (₹${cr(prevTotal)} Cr)` : undefined} />
            {top && <Highlight tone="blue" icon={<UpIcon />} label="Highest Region" value={top.zone} sub={`₹${cr(top.total_paise)} Cr (${share(top).toFixed(1)}%)`} change={data.previous ? growth(top.total_paise, like(prevZone(top.zone))) : null} vs={data.previous ? `vs ${prv} (₹${cr(like(prevZone(top.zone)))} Cr)` : undefined} />}
            {present.length > 0 && <Highlight tone="orange" icon={<BarsIcon size={24} />} label="Highest Quarter" value={`Q${bestQ + 1}`} sub={`₹${cr(quarterTotals[bestQ])} Cr`} change={data.previous ? growth(quarterTotals[bestQ], prevQuarterTotals[bestQ]) : null} vs={data.previous ? `vs ${prv} (₹${cr(prevQuarterTotals[bestQ])} Cr)` : undefined} />}
            {lowest && lowest !== top && <Highlight tone="violet" icon={<PieIcon size={24} />} label="Lowest Region" value={lowest.zone} sub={`₹${cr(lowest.total_paise)} Cr (${share(lowest).toFixed(1)}%)`} change={data.previous ? growth(lowest.total_paise, like(prevZone(lowest.zone))) : null} vs={data.previous ? `vs ${prv} (₹${cr(like(prevZone(lowest.zone)))} Cr)` : undefined} />}
          </div>
        </Card>
      </div>

      <StatesCard data={data} cur={cur} prv={prv} />
    </div>
  );
}

/* ---------------------------------------------------------------- cards */

function Card({ title, icon, banner = false, children }: { title: string; icon: ReactNode; banner?: boolean; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {banner
        ? <div className="flex items-center gap-3 bg-gradient-to-r from-[#0b2a6b] via-[#1450b8] to-[#1e88e5] px-5 py-3 text-white"><span>{icon}</span><h2 className="font-heading text-xl font-bold">{title}</h2></div>
        : <div className="flex items-center gap-2.5 px-4 pt-4 text-[#0b1b4d]"><span className="text-[#2563eb]">{icon}</span><h2 className="font-heading text-lg font-bold">{title}</h2></div>}
      <div className="p-4">{children}</div>
    </section>
  );
}

function QuarterChart({ zones }: { zones: ZoneSales[] }) {
  // Series k holds the k-th largest region of every quarter, coloured by its
  // region, so each quarter reads highest first and lowest last.
  const ranked = [0, 1, 2, 3].map((q) => [...zones].filter((z) => z.quarters[q] > 0).sort((a, b) => b.quarters[q] - a.quarters[q]));
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: FONT },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'none' }, backgroundColor: '#fff', borderColor: '#e2e8f0', textStyle: { color: NAVY },
      formatter: (items: { dataIndex: number }[]) => {
        const q = items[0]?.dataIndex ?? 0;
        return [`<b>Q${q + 1}</b>`, ...ranked[q].map((z) => `<span style="color:${ZONE_COLORS[z.zone]}">●</span> ${z.zone}: ₹${cr(z.quarters[q])} Cr`)].join('<br/>');
      },
    },
    grid: { left: 52, right: 12, top: 18, bottom: 30 },
    xAxis: { type: 'category', data: ['Q1', 'Q2', 'Q3', 'Q4'], axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 14 }, splitLine: { show: true, lineStyle: { color: '#e8edf4' } } },
    yAxis: { type: 'value', axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 13 }, splitLine: { show: false }, name: 'Sales (₹ Cr)', nameLocation: 'middle', nameGap: 38, nameTextStyle: { color: NAVY, fontWeight: 700, fontSize: 13 } },
    series: zones.map((_, k) => ({
      type: 'bar', barGap: '8%', barCategoryGap: '18%',
      data: [0, 1, 2, 3].map((q) => {
        const z = ranked[q][k];
        if (!z) return null;
        return { value: Number((z.quarters[q] / CRORE).toFixed(2)), name: z.zone, itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: ZONE_TOPS[z.zone] }, { offset: 1, color: ZONE_COLORS[z.zone] }] }, borderRadius: [3, 3, 0, 0], shadowColor: 'rgba(15,23,42,.12)', shadowBlur: 3, shadowOffsetY: 1 } };
      }),
      label: { show: true, position: 'top', color: NAVY, fontWeight: 800, fontSize: 13, formatter: ({ value }: { value: number | null }) => (value ? value.toLocaleString('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 2 }) : '') },
    })),
  }), [zones, ranked]);
  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[15px] text-[#0b1b4d]">
        {zones.map((z) => <span key={z.zone} className="flex items-center gap-2"><span className="h-5 w-5 rounded" style={{ background: `linear-gradient(${ZONE_TOPS[z.zone]}, ${ZONE_COLORS[z.zone]})` }} />{z.zone}</span>)}
      </div>
      <div className="h-[290px]"><Chart option={option} className="h-full w-full" /></div>
    </div>
  );
}

function ShareDonut({ zones, total, cur }: { zones: ZoneSales[]; total: number; cur: string }) {
  const shown = zones.filter((z) => z.total_paise > 0);
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: FONT },
    tooltip: { trigger: 'item', formatter: (p: { name: string; value: number; percent: number }) => `${p.name}: ₹${cr(p.value)} Cr (${p.percent.toFixed(1)}%)` },
    series: [{
      type: 'pie', radius: ['48%', '86%'], center: ['50%', '50%'], startAngle: 90, minShowLabelAngle: 16,
      itemStyle: { borderColor: '#fff', borderWidth: 2, shadowBlur: 10, shadowColor: 'rgba(11, 27, 77, 0.25)', shadowOffsetY: 5 },
      label: { show: true, position: 'inside', color: '#fff', fontWeight: 800, fontSize: 13, formatter: ({ percent }: { percent: number }) => `${percent.toFixed(1)}%` },
      data: shown.map((z) => ({ name: z.zone, value: z.total_paise, itemStyle: { color: ZONE_COLORS[z.zone] } })),
    }],
  }), [shown]);
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[minmax(220px,1fr)_minmax(0,1fr)]">
      <div className="relative h-[290px] min-w-0">
        <div className="absolute inset-0" style={{ transform: 'perspective(1100px) rotateX(38deg)', transformOrigin: 'center center', filter: 'drop-shadow(0 22px 0 rgba(5, 43, 103, 0.94)) drop-shadow(0 30px 14px rgba(11, 27, 77, 0.28))' }}>
          <Chart option={option} className="h-full w-full" />
        </div>
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center text-[#0b1b4d]">
            <div className="font-heading text-2xl font-extrabold">₹{cr(total)} Cr</div>
            <div className="text-xs font-medium leading-4">Total {cur}<br />Sales</div>
          </div>
        </div>
      </div>
      <ul className="space-y-4">
        {shown.map((z) => (
          <li key={z.zone} className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-3 text-[15px] text-[#0b1b4d]">
            <span className="h-5 w-5 rounded-full" style={{ background: ZONE_COLORS[z.zone] }} />
            <span>{z.zone}</span>
            <b className="text-right font-heading">₹{cr(z.total_paise)} Cr</b>
            <span className="w-14 text-right tabular-nums">{total ? ((z.total_paise * 100) / total).toFixed(1) : '0.0'}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DetailsTable({ zones, quarterTotals, total, cur }: { zones: ZoneSales[]; quarterTotals: number[]; total: number; cur: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-center text-sm">
        <thead>
          <tr className="text-[13px] font-semibold text-white">
            <th className="bg-[#0b2a6b] px-3 py-2">Quarter</th>
            {zones.map((z) => <th key={z.zone} className="px-3 py-2" style={{ background: HEADER_COLORS[z.zone] }}>{z.zone}</th>)}
            <th className="bg-[#6d28d9] px-3 py-2">Total</th>
          </tr>
        </thead>
        <tbody className="text-[#0b1b4d]">
          {[0, 1, 2, 3].map((q) => (
            <tr key={q} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]">
              <td className="px-3 py-1.5">Q{q + 1}</td>
              {zones.map((z) => <td key={z.zone} className="px-3 py-1.5 tabular-nums">{z.quarters[q] ? cr(z.quarters[q]) : '–'}</td>)}
              <td className="px-3 py-1.5 font-bold tabular-nums">{quarterTotals[q] ? cr(quarterTotals[q]) : '–'}</td>
            </tr>
          ))}
          <tr className="border-t border-emerald-200 bg-[#e3f8ee] font-extrabold">
            <td className="px-3 py-2">Total ({cur})</td>
            {zones.map((z) => <td key={z.zone} className="px-3 py-2 tabular-nums">{cr(z.total_paise)}</td>)}
            <td className="px-3 py-2 tabular-nums">{cr(total)}</td>
          </tr>
          <tr className="bg-[#e3f8ee] font-extrabold">
            <td className="px-3 py-2">Share %</td>
            {zones.map((z) => <td key={z.zone} className="px-3 py-2 tabular-nums">{total ? ((z.total_paise * 100) / total).toFixed(1) : '0.0'}%</td>)}
            <td className="px-3 py-2">100%</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function YoyChart({ prev, curr, cur, prv, note }: { prev: number; curr: number; cur: string; prv: string; note?: string }) {
  const g = growth(curr, prev);
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: FONT },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr` },
    grid: { left: 48, right: 12, top: 46, bottom: 28 },
    xAxis: { type: 'category', data: [prv, cur], axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 13 } },
    yAxis: { type: 'value', axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY }, splitLine: { lineStyle: { color: '#eef2f7' } } },
    series: [{
      type: 'bar', barWidth: '48%',
      data: [
        { value: Number((prev / CRORE).toFixed(2)), itemStyle: { color: PREV_BAR, borderRadius: [3, 3, 0, 0] } },
        { value: Number((curr / CRORE).toFixed(2)), itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#2f86ff' }, { offset: 1, color: '#1559d6' }] }, borderRadius: [3, 3, 0, 0] } },
      ],
      label: { show: true, position: 'top', color: NAVY, fontWeight: 800, fontSize: 14, formatter: ({ value }: { value: number }) => value.toLocaleString('en-IN', { maximumFractionDigits: value >= 10 ? 0 : 2 }) },
    }],
  }), [prev, curr, cur, prv]);
  return (
    <div>
      <div className="flex items-center justify-center gap-6 text-sm text-[#0b1b4d]">
        <span className="flex items-center gap-2"><span className="h-4 w-5 rounded-sm" style={{ background: PREV_BAR }} />{prv}</span>
        <span className="flex items-center gap-2"><span className="h-4 w-5 rounded-sm bg-[#1d6fe0]" />{cur}</span>
      </div>
      <div className="relative h-[250px]">
        {g !== null && (
          <div className={`absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full px-3 py-0.5 text-base font-extrabold ${g >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'}`}>{pct(g)} {g >= 0 ? '↗' : '↘'}</div>
        )}
        <Chart option={option} className="h-full w-full" />
      </div>
      {note && <p className="text-center text-xs text-[#475569]">{note}</p>}
    </div>
  );
}

const HL_TONES = {
  green: 'border-emerald-300 bg-gradient-to-br from-emerald-100 to-white text-emerald-700',
  blue: 'border-sky-300 bg-gradient-to-br from-sky-100 to-white text-blue-700',
  orange: 'border-orange-300 bg-gradient-to-br from-orange-100 to-white text-orange-600',
  violet: 'border-violet-300 bg-gradient-to-br from-violet-100 to-white text-violet-700',
};

function Highlight({ tone, icon, label, value, sub, change, vs }: { tone: keyof typeof HL_TONES; icon: ReactNode; label: string; value: string; sub?: string; change: number | null; vs?: string }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${HL_TONES[tone]}`}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-current shadow-md ring-4 ring-white/70 [&>svg]:text-white">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-semibold">{label}</div>
        <div className="truncate font-heading text-lg font-extrabold leading-tight">{value}</div>
        {sub && <div className="text-sm font-semibold">{sub}</div>}
      </div>
      {change !== null && (
        <div className="shrink-0 border-l border-current/20 pl-3 text-right">
          <div className={`font-heading text-lg font-extrabold ${change >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{change >= 0 ? '↑' : '↓'} {pct(change)}</div>
          {vs && <div className="text-[11px] text-[#475569]">{vs}</div>}
        </div>
      )}
    </div>
  );
}

function StatesCard({ data, cur, prv }: { data: RegionSummary; cur: string; prv: string }) {
  const [all, setAll] = useState(false);
  const total = data.states.reduce((a, s) => a + s.amount_paise, 0);
  const states = data.states.filter((s) => s.amount_paise > 0 || s.prev_amount_paise > 0);
  const shown = all ? states : states.slice(0, 10);
  return (
    <Card title={`State-wise Sales (₹ Cr) – ${cur}`} icon={<PieIcon />}>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[#0b2a6b] text-left text-[13px] font-semibold text-white">
              <th className="px-3 py-2">State</th><th className="px-3 py-2 text-center">Code</th><th className="px-3 py-2">Region</th>
              <th className="px-3 py-2 text-right">{cur}</th><th className="px-3 py-2 text-right">Share</th>
              {data.previous && <th className="px-3 py-2 text-right">{prv}</th>}
            </tr>
          </thead>
          <tbody className="text-[#0b1b4d]">
            {shown.map((s) => (
              <tr key={s.code ?? '--'} className="border-t border-slate-200 odd:bg-white even:bg-[#f4f8fd]">
                <td className="px-3 py-1.5 font-semibold">{s.state}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{s.code ?? '–'}</td>
                <td className="px-3 py-1.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: ZONE_COLORS[s.zone] }} />{s.zone}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{cr(s.amount_paise)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{total ? ((s.amount_paise * 100) / total).toFixed(1) : '0.0'}%</td>
                {data.previous && <td className="px-3 py-1.5 text-right tabular-nums text-[#475569]">{cr(s.prev_amount_paise)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {states.length > 10 && (
        <button type="button" onClick={() => setAll(!all)} className="mt-2 text-sm font-semibold text-[#1d6fe0] hover:underline">
          {all ? 'Show top 10' : `Show all ${states.length} states`}
        </button>
      )}
    </Card>
  );
}

/* ---------------------------------------------------------------- helpers */

function BarsIcon({ size = 22 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M5 20v-6M10 20V10M15 20V7M20 20V4" /></svg>; }
function PieIcon({ size = 22 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M11 3.05A9 9 0 1 0 20.95 13H11V3.05Z" /><path d="M13 3.05V11h7.95A9 9 0 0 0 13 3.05Z" opacity=".6" /></svg>; }
function UpIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 19 19 5m0 0h-9m9 0v9" /></svg>; }
function CalendarIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18M8 14h2m4 0h2m-8 3h2" /></svg>; }

/* The template's sample (FY25 vs FY24), used by tests and design checks. */
const q = (xs: number[]) => xs.map((v) => v * CRORE);
export const SAMPLE_REGIONS: RegionSummary = {
  fy: 2024,
  available_fys: [2023, 2024],
  zones: [
    { zone: 'North', quarters: q([50, 55, 53, 52]), total_paise: 210 * CRORE },
    { zone: 'South', quarters: q([36, 38, 40, 36]), total_paise: 150 * CRORE },
    { zone: 'East', quarters: q([20, 22, 22, 21]), total_paise: 85 * CRORE },
    { zone: 'West', quarters: q([14, 15, 20, 23]), total_paise: 72 * CRORE },
  ],
  previous: [
    { zone: 'North', quarters: q([45, 46, 46, 46]), total_paise: 183 * CRORE },
    { zone: 'South', quarters: q([33, 34, 35, 34]), total_paise: 136 * CRORE },
    { zone: 'East', quarters: q([18, 19, 19, 18]), total_paise: 74 * CRORE },
    { zone: 'West', quarters: q([16, 17, 16, 18]), total_paise: 67 * CRORE },
  ],
  states: [
    { code: '27', state: 'Maharashtra', zone: 'West', amount_paise: 40 * CRORE, prev_amount_paise: 38 * CRORE },
    { code: '09', state: 'Uttar Pradesh', zone: 'North', amount_paise: 120 * CRORE, prev_amount_paise: 100 * CRORE },
  ],
};
