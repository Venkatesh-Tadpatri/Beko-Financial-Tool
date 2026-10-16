import { useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { reportApi, type SalesSummary } from '../api/data';
import { Chart } from '../components/Chart';

const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
const COLORS = ['#0752a4', '#08a68f', '#f8b700', '#349cf0', '#7829df', '#858585', '#ef6c35', '#d9468f', '#14b8a6'];
type Product = { name: string; sales: number; units: number; average: number; share: number; color: string };

export function ProductMixPage() {
  const [report, setReport] = useState<SalesSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void reportApi.salesSummary().then(setReport).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <EmptyState text={error} />;
  if (!report) return <EmptyState text="Loading sales data…" />;
  if (!report.products.length) return <EmptyState text="No sales data is available. Upload and import a Sales Register file to populate this page." />;

  const products: Product[] = report.products.map((p, index) => ({ name: p.name, sales: p.amount_paise / 1_000_000_000, units: p.units ?? 0, average: (p.average_unit_paise ?? 0) / 10_000_000, share: p.share, color: COLORS[index % COLORS.length] }));
  const total = report.total_paise / 1_000_000_000;
  const leaders = products.slice(0, 2);
  const leaderShare = leaders.reduce((sum, p) => sum + p.share, 0);
  const shortFy = report.fy === null ? 'FY' : `FY${String(report.fy + 1).slice(-2)}`;
  const range = report.fy === null ? '' : `Apr ${report.fy} – Mar ${report.fy + 1}`;

  return <div className="space-y-4 pb-2">
    <header className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0"><div className="mb-1 text-xs font-bold uppercase tracking-[0.18em] text-teal-600">Sales &nbsp;|&nbsp; Product Mix</div><h1 className="font-heading text-3xl font-extrabold leading-tight text-navy-900 2xl:text-4xl">{leaders.map((p) => p.name).join(' and ')} drive <span className="text-brand-600">{leaderShare.toFixed(1)}% of sales</span> ({shortFy})</h1></div>
      <div className="flex min-w-[224px] items-center gap-3 rounded-2xl bg-gradient-to-br from-sky-50 to-blue-50 px-5 py-3 shadow-sm"><CalendarIcon /><div className="whitespace-nowrap text-navy-900"><div className="text-xs font-semibold">Financial Year</div><div className="font-heading text-2xl font-extrabold leading-tight">{shortFy}</div><div className="text-xs font-semibold">({range})</div></div></div>
    </header>
    <div className="grid gap-4 xl:grid-cols-2">
      <ReportCard title={`Sales by Product (₹ Cr) – ${shortFy}`} icon="▥"><SalesBarChart products={products} /></ReportCard>
      <ReportCard title={`Sales Share by Product – ${shortFy}`} icon="◔"><ProductDonut products={products} total={total} fy={shortFy} /></ReportCard>
      <SalesDetails products={products} total={total} totalUnits={report.total_units} fy={shortFy} />
      <ShareSummary products={products} total={total} fy={shortFy} />
    </div>
  </div>;
}

function EmptyState({ text }: { text: string }) { return <div className="rounded-2xl border border-sky-200 bg-white p-10 text-center text-muted shadow-sm">{text}</div>; }
function fmt(value: number, digits = 2) { return value.toLocaleString('en-IN', { maximumFractionDigits: digits }); }
function ReportCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) { return <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm"><div className="flex items-center gap-3 bg-gradient-to-r from-navy-800 via-blue-700 to-cyan-500 px-5 py-3 text-white"><span className="text-2xl" aria-hidden="true">{icon}</span><h2 className="font-heading text-xl font-bold">{title}</h2></div>{children}</section>; }

function SalesBarChart({ products }: { products: Product[] }) {
  const shown = products.slice(0, 9);
  const maximum = Math.max(...shown.map((p) => p.sales)) * 1.25;
  const option = useMemo<EChartsCoreOption>(() => ({ textStyle: { fontFamily: FONT }, grid: { left: 125, right: 105, top: 16, bottom: 48 }, tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `₹${fmt(v)} Cr` }, xAxis: { type: 'value', max: maximum, name: 'Sales (₹ Cr)', nameLocation: 'middle', nameGap: 34, nameTextStyle: { color: '#071458', fontWeight: 700 }, axisLabel: { color: '#071458' }, splitLine: { lineStyle: { color: '#dce9f4' } } }, yAxis: { type: 'category', inverse: true, data: shown.map((p) => p.name), axisTick: { show: false }, axisLabel: { width: 110, overflow: 'truncate', color: '#071458', fontSize: 12, fontWeight: 600 } }, series: [{ type: 'bar', barWidth: 23, data: shown.map((p) => ({ value: p.sales, itemStyle: { color: p.color, borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#071458', fontSize: 11, fontWeight: 700, formatter: `₹${fmt(p.sales)} Cr (${p.share.toFixed(1)}%)` } })) }] }), [maximum, shown]);
  return <div className="h-[330px] p-2"><Chart option={option} className="h-full w-full" /></div>;
}

function ProductDonut({ products, total, fy }: { products: Product[]; total: number; fy: string }) {
  const shown = products.slice(0, 9);
  const option = useMemo<EChartsCoreOption>(() => ({ textStyle: { fontFamily: FONT }, color: shown.map((p) => p.color), tooltip: { trigger: 'item', formatter: '{b}: ₹{c} Cr ({d}%)' }, series: [{ type: 'pie', radius: ['39%', '69%'], center: ['50%', '52%'], minShowLabelAngle: 7, itemStyle: { borderColor: '#fff', borderWidth: 1 }, label: { show: true, position: 'inside', color: '#fff', fontSize: 10, fontWeight: 800, formatter: ({ percent }: { percent?: number }) => `${(percent ?? 0).toFixed(1)}%` }, labelLine: { show: false }, data: shown.map((p) => ({ name: p.name, value: Number(p.sales.toFixed(4)) })) }] }), [shown]);
  return <div className="grid min-h-[330px] items-center gap-1 px-2 py-4 sm:grid-cols-[minmax(235px,1fr)_minmax(215px,0.9fr)]"><div className="relative h-[300px] min-w-0"><Chart option={option} className="h-full w-full" /><div className="pointer-events-none absolute left-1/2 top-[52%] w-28 -translate-x-1/2 -translate-y-1/2 text-center text-navy-900"><div className="whitespace-nowrap font-heading text-lg font-extrabold leading-none">₹{fmt(total)} Cr</div><div className="mt-2 text-xs font-medium leading-4">Total {fy}<br />Sales</div></div></div><div className="min-w-0 space-y-2 px-2 sm:px-0">{shown.map((p) => <div key={p.name} className="grid grid-cols-[minmax(80px,1fr)_70px_44px] items-center gap-1.5 text-xs text-navy-900"><div className="flex min-w-0 items-center gap-2"><span className="h-3.5 w-3.5 shrink-0 rounded" style={{ backgroundColor: p.color }} /><span className="truncate font-medium" title={p.name}>{p.name}</span></div><span className="whitespace-nowrap text-right font-extrabold">₹{fmt(p.sales)} Cr</span><span className="text-right tabular-nums">{p.share.toFixed(1)}%</span></div>)}</div></div>;
}

function SalesDetails({ products, total, totalUnits, fy }: { products: Product[]; total: number; totalUnits: number; fy: string }) {
  const overallAverage = totalUnits ? total * 100 / totalUnits : 0;
  return <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white p-3 shadow-sm"><h2 className="mb-2 font-heading text-lg font-bold text-navy-900">▥ &nbsp; Product-wise Sales Details (₹ Cr) – {fy}</h2><div className="overflow-x-auto"><table className="w-full border-collapse text-center text-sm"><thead className="text-white"><tr>{['Product','Sales\n(₹ Cr)','Share %','No. of Units','Avg. Value per Unit\n(₹ Lakh)'].map((h,i)=><th key={h} className={`${['bg-navy-800','bg-blue-600','bg-cyan-600','bg-violet-600','bg-orange-500'][i]} whitespace-pre-line border border-white/30 px-2 py-2`}>{h}</th>)}</tr></thead><tbody>{products.map((p)=><tr key={p.name} className="border-b border-sky-100 even:bg-sky-50/70"><td className="p-1.5 font-medium">{p.name}</td><td>{fmt(p.sales)}</td><td>{p.share.toFixed(1)}%</td><td>{p.units.toLocaleString('en-IN')}</td><td>{fmt(p.average)}</td></tr>)}<tr className="bg-emerald-100/80 font-extrabold text-navy-900"><td className="p-2">Total</td><td>{fmt(total)}</td><td>100%</td><td>{totalUnits.toLocaleString('en-IN')}</td><td>{fmt(overallAverage)}</td></tr></tbody></table></div></section>;
}

function ShareSummary({ products, total, fy }: { products: Product[]; total: number; fy: string }) { return <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white p-3 shadow-sm"><h2 className="mb-2 font-heading text-lg font-bold text-navy-900">◔ &nbsp; Product Share Summary – {fy}</h2><div className="overflow-x-auto"><table className="w-full border-collapse text-center text-sm"><thead className="text-white"><tr><th className="bg-navy-800 p-2">Product</th><th className="bg-blue-600 p-2">Sales<br />(₹ Cr)</th><th className="bg-cyan-600 p-2">Share %</th><th className="bg-violet-600 p-2">Contribution (Visual)</th></tr></thead><tbody>{products.map((p)=><tr key={p.name} className="border-b border-sky-100 even:bg-sky-50/70"><td className="p-1.5 font-medium">{p.name}</td><td>{fmt(p.sales)}</td><td>{p.share.toFixed(1)}%</td><td className="min-w-56 px-3"><div className="flex items-center gap-3"><div className="h-3 flex-1 overflow-hidden rounded bg-slate-100"><div className="h-full rounded" style={{width:`${p.share}%`,backgroundColor:p.color}} /></div><span className="w-12 text-right">{p.share.toFixed(1)}%</span></div></td></tr>)}<tr className="bg-emerald-100/80 font-extrabold text-navy-900"><td className="p-2">Total</td><td>{fmt(total)}</td><td>100%</td><td className="px-3"><div className="flex items-center gap-3"><div className="h-3 flex-1 rounded bg-blue-700" /><span className="w-12 text-right">100%</span></div></td></tr></tbody></table></div></section>; }
function CalendarIcon() { return <svg className="h-11 w-11 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /><path d="M7 14h2m3 0h2m3 0h1M7 17h2m3 0h2m3 0h1" /></svg>; }
