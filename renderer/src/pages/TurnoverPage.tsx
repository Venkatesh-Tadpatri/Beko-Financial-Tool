import { useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { reportApi, type SalesSummary } from '../api/data';
import { Chart } from '../components/Chart';

/* ------------------------------------------------------------------ palette */
const INK = '#172033';
const MUTED = '#5b6678';
const LINE = '#e3e7ef';
const ARROW = '#f59e0b';
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";

/* --------------------------------------------------------- placeholder data */
// Static for now; the next step maps these to the approved-data API.
const YEARS = ['FY06', 'FY07', 'FY08', 'FY09', 'FY10', 'FY11', 'FY12', 'FY13', 'FY14', 'FY15', 'FY16', 'FY17', 'FY18', 'FY19', 'FY20', 'FY21', 'FY22', 'FY23', 'FY24', 'FY25'];
const TURNOVER = [100, 110, 120, 132, 145, 160, 175, 192, 210, 230, 252, 276, 298, 322, 300, 350, 378, 408, 440, 480];
const DECLINE_INDEX = YEARS.indexOf('FY20');
// Keep the trend line clear of the value labels while preserving the real
// year-to-year shape, including the FY20 dip and FY21 recovery.
const GROWTH_TREND = TURNOVER.map((value) => value + 45);
const GROWTH_ARROW = 'path://M0,1 L18,8 L0,15 L5,8 Z';

type Row = { fy: string; value: number; change: number | null; growth: number | null };
const ROWS: Row[] = TURNOVER.map((value, i) => {
  const prev = i === 0 ? null : TURNOVER[i - 1];
  return { fy: YEARS[i], value, change: prev === null ? null : value - prev, growth: prev === null ? null : ((value - prev) / prev) * 100 };
});

interface StatItem {
  key: string;
  label: string;
  note: string;
  value: string;
  sub?: string;
  icon: string;
  tint: keyof typeof STAT_TINT;
}
const STATS: StatItem[] = [
  { key: 'growth', label: '20-year growth', note: '(FY06 to FY25)', value: '+380%', icon: 'bars', tint: 'green' },
  { key: 'cagr', label: 'CAGR', note: '(FY06 to FY25)', value: '8.6%', icon: 'trend', tint: 'violet' },
  { key: 'fy25', label: 'FY25 turnover', note: '', value: '₹480 Cr', icon: 'coins', tint: 'blue' },
  { key: 'base', label: 'FY06 base turnover', note: '', value: '₹100 Cr', icon: 'stack', tint: 'amber' },
  { key: 'low', label: 'Lowest year (FY20)', note: '', value: '₹300 Cr', sub: '−6.8% YoY', icon: 'down', tint: 'red' },
  { key: 'peak', label: 'Peak YoY growth', note: '', value: 'FY21 +16.7%', icon: 'bars', tint: 'green' },
];

const TAKEAWAYS = [
  { dot: '#14b8a6', tone: 'border-teal-100 bg-teal-50/70', text: <>Turnover increased from <b>₹100 Cr</b> in FY06 to <b>₹480 Cr</b> in FY25, a growth of <b>4.8× (380%)</b>.</> },
  { dot: '#7c3aed', tone: 'border-violet-100 bg-violet-50/70', text: <>CAGR over 20 years: <b>8.6%</b>.</> },
  { dot: '#ef4444', tone: 'border-rose-100 bg-rose-50/70', text: <>One year of decline observed in FY20: <b>₹22 Cr (−6.8%)</b> due to market slowdown.</> },
  { dot: '#16a34a', tone: 'border-emerald-100 bg-emerald-50/70', text: <>Highest year-on-year growth: <b>16.7% in FY21 (₹50 Cr increase)</b>.</> },
  { dot: '#2563eb', tone: 'border-blue-100 bg-blue-50/70', text: <>Overall trend shows steady and consistent growth in turnover over the 20 years.</> },
];

/* ---------------------------------------------------------------- component */

export function TurnoverPage() {
  const [report, setReport] = useState<SalesSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void reportApi.salesSummary().then(setReport).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center text-rose-600">{error}</div>;
  if (!report) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">Loading sales data…</div>;
  if (!report.periods.length) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">No sales data is available.</div>;
  return <LiveTurnover report={report} />;
}

function LiveTurnover({ report }: { report: SalesSummary }) {
  return <ReferenceTurnover report={report} />;
  /* Legacy compact layout retained below for comparison. */
  const values = report.periods.map((p) => p.amount_paise / 1_000_000_000);
  const total = report.total_paise / 1_000_000_000;
  const option = useMemo<EChartsCoreOption>(() => ({ textStyle: { fontFamily: FONT }, tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${v.toFixed(2)} Cr` }, grid: { left: 60, right: 25, top: 45, bottom: 55 }, xAxis: { type: 'category', data: report.periods.map((p) => p.label), name: 'Billing period', nameLocation: 'middle', nameGap: 35 }, yAxis: { type: 'value', name: 'Turnover (₹ Cr)', nameLocation: 'middle', nameGap: 48, splitLine: { lineStyle: { color: LINE } } }, series: [{ type: 'line', smooth: true, symbolSize: 10, data: values, lineStyle: { width: 4, color: '#2563eb' }, itemStyle: { color: '#0ea5e9' }, areaStyle: { color: 'rgba(37,99,235,.10)' }, label: { show: true, position: 'top', formatter: ({ value }: { value: number }) => `₹${value.toFixed(2)} Cr`, color: INK, fontWeight: 700 } }] }), [report.periods, values]);
  const max = Math.max(...values), min = Math.min(...values);
  return <div className="space-y-5"><header><div className="text-xs font-bold uppercase tracking-[.2em] text-teal-600">Turnover · Approved Quarterly Input</div><h1 className="font-heading text-4xl font-extrabold text-navy-900">{report.fy_label} turnover <span className="text-brand-600">₹{total.toFixed(2)} Cr</span></h1></header><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Total turnover',`₹${total.toFixed(2)} Cr`],['Highest month',`₹${max.toFixed(2)} Cr`],['Lowest month',`₹${min.toFixed(2)} Cr`],['Transactions',report.row_count.toLocaleString('en-IN')]].map(([label,value])=><div key={label} className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm"><div className="text-xs font-bold text-muted">{label}</div><div className="mt-1 font-heading text-xl font-extrabold text-blue-700">{value}</div></div>)}</div><section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm"><div className="bg-gradient-to-r from-navy-800 via-blue-700 to-cyan-500 px-5 py-3"><h2 className="font-heading text-xl font-bold text-white">Turnover Trend from Uploaded Quarter</h2></div><div className="h-[420px] p-4"><Chart option={option} className="h-full w-full" /></div></section></div>;
}

function ReferenceTurnover({ report }: { report: SalesSummary }) {
  const values = report.periods.map((p) => p.amount_paise / 1_000_000_000);
  const total = report.total_paise / 1_000_000_000;
  const high = Math.max(...values), low = Math.min(...values), avg = total / values.length;
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: FONT }, tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${v.toFixed(2)} Cr` },
    grid: { left: 64, right: 28, top: 42, bottom: 54 },
    xAxis: { type: 'category', data: report.periods.map((p) => p.label), axisTick: { show: false }, name: 'Billing Period', nameLocation: 'middle', nameGap: 34 },
    yAxis: { type: 'value', name: 'Turnover (₹ Crore)', nameLocation: 'middle', nameGap: 48, splitLine: { lineStyle: { color: '#dbeafe', type: 'dashed' } } },
    series: [{ type: 'bar', barWidth: '58%', data: values.map((value, i) => ({ value, itemStyle: { color: barGradient(i / Math.max(1, values.length - 1), false), borderRadius: [7,7,0,0] } })), label: { show: true, position: 'top', formatter: ({ value }: { value: number }) => `₹${value.toFixed(2)}`, fontWeight: 800, color: INK } }, { type: 'line', smooth: true, data: values, symbolSize: 8, lineStyle: { color: '#f59e0b', width: 3 }, itemStyle: { color: '#f59e0b' } }],
  }), [report.periods, values]);
  const cards = [['Total turnover', `₹${total.toFixed(2)} Cr`, 'emerald'], ['Highest period', `₹${high.toFixed(2)} Cr`, 'violet'], ['Average period', `₹${avg.toFixed(2)} Cr`, 'blue'], ['Lowest period', `₹${low.toFixed(2)} Cr`, 'amber'], ['Transactions', report.row_count.toLocaleString('en-IN'), 'red'], ['Documents', report.billing_documents.toLocaleString('en-IN'), 'cyan']];
  const tones: Record<string,string> = { emerald:'border-emerald-200 from-emerald-50 text-emerald-700', violet:'border-violet-200 from-violet-50 text-violet-700', blue:'border-blue-200 from-blue-50 text-blue-700', amber:'border-orange-200 from-orange-50 text-orange-600', red:'border-rose-200 from-rose-50 text-rose-600', cyan:'border-cyan-200 from-cyan-50 text-cyan-700' };
  return <div className="space-y-5">
    <header><div className="text-xs font-bold uppercase tracking-[.22em] text-teal-600">Financial performance</div><h1 className="font-heading text-4xl font-extrabold text-navy-900">{report.fy_label} turnover is <span className="text-brand-600">₹{total.toFixed(2)} Cr</span></h1><p className="mt-2 rounded-xl border-l-4 border-teal-500 bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-2 text-sm"><b>In plain words:</b> Every value below comes from the latest uploaded Sales Register.</p></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{cards.map(([label,value,tone])=><div key={label} className={`rounded-2xl border bg-gradient-to-br to-white p-4 shadow-sm ${tones[tone]}`}><div className="text-xs font-bold text-ink">{label}</div><div className="mt-2 font-heading text-xl font-extrabold">{value}</div></div>)}</div>
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm"><div className="bg-gradient-to-r from-navy-900 via-blue-700 to-cyan-500 px-5 py-3 text-xl font-bold text-white">Turnover Trend from Uploaded Data</div><div className="h-[420px] p-4"><Chart option={option} className="h-full w-full" /></div></section>
    <div className="grid gap-5 lg:grid-cols-5"><section className="overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-violet-50 p-4 shadow-sm lg:col-span-3"><h2 className="mb-3 text-lg font-bold">Period-wise Turnover Details</h2><table className="w-full text-sm"><thead className="bg-gradient-to-r from-cyan-700 via-blue-600 to-violet-600 text-white"><tr><th className="p-2 text-left">Period</th><th>Turnover (₹ Cr)</th><th>Units</th><th>Share</th></tr></thead><tbody>{report.periods.map(p=><tr key={p.label} className="border-b border-sky-100 even:bg-sky-50"><td className="p-2 font-bold">{p.label}</td><td className="text-center">{(p.amount_paise/1e9).toFixed(2)}</td><td className="text-center">{p.units.toLocaleString('en-IN')}</td><td className="text-center font-bold">{(p.amount_paise*100/report.total_paise).toFixed(1)}%</td></tr>)}</tbody></table></section><section className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-blue-50 p-4 shadow-sm lg:col-span-2"><h2 className="mb-3 text-lg font-bold">💡 Key Takeaways</h2><ul className="space-y-3 text-sm"><li className="rounded-xl bg-white p-3">Total turnover: <b>₹{total.toFixed(2)} Cr</b></li><li className="rounded-xl bg-emerald-50 p-3">Strongest period: <b>₹{high.toFixed(2)} Cr</b></li><li className="rounded-xl bg-violet-50 p-3">Average per period: <b>₹{avg.toFixed(2)} Cr</b></li></ul></section></div>
  </div>;
}

export function StaticTurnoverPage() {
  return (
    <div className="space-y-5">
      <Header />
      <div className="grid grid-cols-6 gap-3">
        {STATS.map((s) => (
          <StatCard key={s.key} item={s} />
        ))}
      </div>
      <TrendCard />
      <div className="grid gap-5 lg:grid-cols-5">
        <TablesCard className="lg:col-span-3" />
        <TakeawaysCard className="lg:col-span-2" />
      </div>
    </div>
  );
}

function Header() {
  return (
    <header>
      <h1 className="font-heading text-4xl font-extrabold text-navy-900">
        Turnover grew <span className="text-brand-600">4.8×</span> in <span className="text-brand-600">20 years</span>
      </h1>
    </header>
  );
}

/* --------------------------------------------------------------- trend card */

function TrendCard() {
  const option = useMemo<EChartsCoreOption>(() => {
    const data = TURNOVER.map((v, i) => ({
      value: v,
      itemStyle: { color: barGradient(i === DECLINE_INDEX ? null : i / (TURNOVER.length - 1), i === DECLINE_INDEX) },
    }));
    return {
      textStyle: { fontFamily: FONT },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${v} Cr`, backgroundColor: '#fff', borderColor: LINE, textStyle: { color: INK } },
      grid: { left: 64, right: 38, top: 40, bottom: 56 },
      xAxis: {
        type: 'category', data: YEARS, axisTick: { show: false }, axisLine: { lineStyle: { color: LINE } },
        axisLabel: { color: MUTED, fontSize: 11, interval: 0, rotate: 0 },
        name: 'Financial Year', nameLocation: 'middle', nameGap: 36, nameTextStyle: { color: INK, fontSize: 12, fontWeight: 700 },
      },
      yAxis: {
        type: 'value', min: 0, max: 600, interval: 100, axisLabel: { color: MUTED }, splitLine: { lineStyle: { color: LINE, type: 'dashed' } },
        name: 'Annual Turnover (₹ Crore)', nameLocation: 'middle', nameRotate: 90, nameGap: 44, nameTextStyle: { color: INK, fontSize: 12, fontWeight: 700 },
      },
      series: [
        {
          name: 'Turnover', type: 'bar', data, barWidth: '62%', z: 2, itemStyle: { borderRadius: [5, 5, 0, 0] },
          label: { show: true, position: 'top', color: INK, fontWeight: 700, fontSize: 11, formatter: (p: { value: number }) => `₹${p.value}` },
          markLine: {
            silent: true,
            symbol: ['none', 'arrow'],
            symbolSize: [0, 13],
            lineStyle: { color: '#ef4444', width: 2 },
            label: {
              show: true,
              position: 'start',
              distance: 8,
              formatter: '{year|FY20}\n{copy|Turnover declined by}\n{loss|₹22 Cr (−6.8%)}\n{copy|due to market slowdown}',
              align: 'center',
              color: INK,
              backgroundColor: '#fff1f2',
              borderColor: '#fb7185',
              borderWidth: 1,
              borderRadius: 10,
              padding: [8, 12],
              lineHeight: 16,
              rich: {
                year: { color: '#e11d48', fontWeight: 800, fontSize: 12 },
                copy: { color: INK, fontSize: 11 },
                loss: { color: '#dc2626', fontWeight: 800, fontSize: 12 },
              },
            },
            data: [[{ coord: ['FY20', 515] }, { coord: ['FY20', 310] }]],
          },
        },
        // Offset above the labels and shaped by the actual annual changes.
        {
          name: '4.8× growth', type: 'line', data: GROWTH_TREND, smooth: 0.25, z: 3,
          symbol: GROWTH_ARROW,
          symbolSize: (_value: number, params: { dataIndex: number }) => params.dataIndex === YEARS.length - 1 ? [25, 20] : 0,
          symbolOffset: (_value: number, params: { dataIndex: number }) => params.dataIndex === YEARS.length - 1 ? [10, 0] : [0, 0],
          itemStyle: { color: ARROW },
          lineStyle: { color: ARROW, width: 4, cap: 'round' },
          tooltip: { show: false },
          markPoint: {
            silent: true,
            symbolSize: 1,
            itemStyle: { opacity: 0 },
            label: {
              show: true,
              position: 'top',
              distance: 8,
              formatter: '4.8× Growth',
              color: '#fff',
              fontSize: 12,
              fontWeight: 800,
              backgroundColor: '#f97316',
              borderRadius: 12,
              padding: [5, 10],
            },
            data: [{ coord: ['FY23', GROWTH_TREND[17]] }],
          },
        },
      ],
    };
  }, []);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-heading text-xl font-bold text-navy-900">Annual Turnover Trend (FY06 – FY25)</h2>
          <div className="text-sm font-semibold text-brand-600">Turnover (₹ Crore)</div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700">
            FY20 declined ₹22 Cr (−6.8%) — market slowdown
          </span>
          <span className="text-xs font-medium text-muted">FY06–FY25 performance</span>
        </div>
      </div>
      <div className="mt-3 w-full" style={{ height: 420 }}>
        <Chart option={option} className="h-full w-full" />
      </div>
    </section>
  );
}

function barGradient(t: number | null, decline: boolean) {
  if (decline || t === null) {
    return { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#f87171' }, { offset: 1, color: '#dc2626' }] };
  }
  // teal -> blue -> violet across the 20 years.
  const base = t < 0.5 ? mix('#14b8a6', '#2563eb', t / 0.5) : mix('#2563eb', '#6d28d9', (t - 0.5) / 0.5);
  return { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: lighten(base, 0.18) }, { offset: 1, color: base }] };
}

/* ------------------------------------------------------------- tables card */

function TablesCard({ className = '' }: { className?: string }) {
  const half = Math.ceil(ROWS.length / 2);
  return (
    <section className={`overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/80 via-white to-violet-50/50 p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-sm">
          <Glyph name="table" />
        </span>
        <h2 className="font-heading text-lg font-bold text-navy-900">Year-wise Turnover and Growth Details</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <DetailTable rows={ROWS.slice(0, half)} />
        <DetailTable rows={ROWS.slice(half)} />
      </div>
    </section>
  );
}

function DetailTable({ rows }: { rows: Row[] }) {
  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <thead>
        <tr className="text-[11px] font-semibold text-white">
          <th className="w-[22%] rounded-l-md bg-gradient-to-b from-cyan-600 to-cyan-700 px-2 py-2.5 text-left">FY</th>
          <th className="w-[26%] bg-gradient-to-b from-teal-500 to-teal-600 px-2 py-2.5 text-right">Turnover<br />(₹ Cr)</th>
          <th className="w-[26%] bg-gradient-to-b from-violet-500 to-violet-700 px-2 py-2.5 text-right">YoY chg<br />(₹ Cr)</th>
          <th className="w-[26%] rounded-r-md bg-gradient-to-b from-orange-400 to-orange-600 px-2 py-2.5 text-right">YoY growth<br />(%)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const tone = r.fy === 'FY20' ? 'bg-rose-100/80 text-rose-700' : r.fy === 'FY21' ? 'bg-emerald-100/80 text-emerald-700' : 'odd:bg-white/90 even:bg-sky-50/80 text-ink';
          const strong = r.fy === 'FY20' || r.fy === 'FY21' ? 'font-bold' : '';
          return (
            <tr key={r.fy} className={`${tone} ${strong} border-b border-sky-100 transition-colors hover:bg-amber-50`}>
              <td className="whitespace-nowrap px-2 py-2 font-semibold">{r.fy}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{r.value}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{r.change === null ? '–' : r.change}</td>
              <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{r.growth === null ? '–' : `${r.growth.toFixed(1)}%`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------------------------------------------------------- takeaways card */

function TakeawaysCard({ className = '' }: { className?: string }) {
  return (
    <section className={`overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50/80 via-white to-blue-50/80 p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-amber-300 to-orange-500 text-white shadow-sm">
          <Glyph name="bulb" />
        </span>
        <h2 className="font-heading text-lg font-bold text-navy-900">Key Takeaways</h2>
      </div>
      <ul className="space-y-2.5">
        {TAKEAWAYS.map((t, i) => (
          <li key={i} className={`flex gap-2.5 rounded-xl border p-3 text-sm text-ink ${t.tone}`}>
            <span className="mt-1 h-3 w-3 shrink-0 rounded-full shadow-sm ring-4 ring-white" style={{ background: t.dot }} />
            <span>{t.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------- stat cards */

const STAT_TINT: Record<string, { bg: string; icon: string; value: string }> = {
  green: { bg: 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white', icon: 'bg-emerald-100 text-emerald-600', value: 'text-emerald-600' },
  violet: { bg: 'border-violet-100 bg-gradient-to-br from-violet-50 to-white', icon: 'bg-violet-100 text-violet-600', value: 'text-violet-600' },
  blue: { bg: 'border-blue-100 bg-gradient-to-br from-blue-50 to-white', icon: 'bg-blue-100 text-blue-600', value: 'text-brand-600' },
  amber: { bg: 'border-amber-100 bg-gradient-to-br from-amber-50 to-white', icon: 'bg-amber-100 text-amber-600', value: 'text-amber-600' },
  red: { bg: 'border-rose-100 bg-gradient-to-br from-rose-50 to-white', icon: 'bg-rose-100 text-rose-600', value: 'text-rose-600' },
};

function StatCard({ item: { label, note, value, sub, icon, tint } }: { item: StatItem }) {
  const t = STAT_TINT[tint];
  return (
    <div className={`min-w-0 rounded-2xl border p-3 shadow-sm ${t.bg}`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${t.icon}`}>
          <Glyph name={icon} />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="text-[13px] font-semibold text-ink">{label}</div>
          {note && <div className="text-[11px] text-muted">{note}</div>}
        </div>
      </div>
      <div className={`mt-2 truncate font-heading text-xl font-extrabold ${t.value}`}>{value}</div>
      {sub && <div className={`text-xs font-semibold ${t.value}`}>{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
function lighten(rgb: string, amt: number) {
  const m = rgb.match(/\d+/g)!.map(Number);
  const c = m.map((v) => Math.round(v + (255 - v) * amt));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function Glyph({ name }: { name: string }) {
  const p = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'bars':
      return (<svg {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>);
    case 'trend':
      return (<svg {...p}><path d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" /></svg>);
    case 'coins':
      return (<svg {...p}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>);
    case 'stack':
      return (<svg {...p}><path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 18l9 5 9-5" /></svg>);
    case 'down':
      return (<svg {...p}><path d="M3 7l6 6 4-4 8 8m0 0v-5m0 5h-5" /></svg>);
    case 'table':
      return (<svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></svg>);
    case 'bulb':
      return (<svg {...p}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3Z" /></svg>);
    default:
      return null;
  }
}
