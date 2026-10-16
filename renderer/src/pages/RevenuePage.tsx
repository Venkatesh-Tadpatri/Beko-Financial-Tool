import { useEffect, useMemo, useState } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { reportApi, type SalesSummary } from '../api/data';
import { Chart } from '../components/Chart';

const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const FY24 = [120, 140, 100, 130];
const FY25 = [110, 150, 95, 165];
const CHANGES = FY25.map((value, i) => value - FY24[i]);
const GROWTH = CHANGES.map((value, i) => (value / FY24[i]) * 100);

const KPI = [
  { label: 'FY24 Total Revenue', value: '₹490 Cr', icon: 'coins', tone: 'emerald' },
  { label: 'FY25 Total Revenue', value: '₹520 Cr', icon: 'coins', tone: 'blue' },
  { label: 'Increase (YoY)', value: '+ ₹30 Cr', note: '(+6.1%)', icon: 'bars', tone: 'orange' },
  { label: 'Strongest Quarter Growth', value: 'Q4 +26.9%', icon: 'trend', tone: 'violet' },
  { label: 'Largest Decline', value: 'Q1 −8.3%', icon: 'down', tone: 'rose' },
] as const;

const TONES = {
  emerald: { card: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white', icon: 'bg-emerald-100 text-emerald-700', value: 'text-emerald-700' },
  blue: { card: 'border-blue-200 bg-gradient-to-br from-blue-50 to-white', icon: 'bg-blue-100 text-blue-700', value: 'text-blue-700' },
  orange: { card: 'border-orange-200 bg-gradient-to-br from-orange-50 to-white', icon: 'bg-orange-100 text-orange-600', value: 'text-orange-600' },
  violet: { card: 'border-violet-200 bg-gradient-to-br from-violet-50 to-white', icon: 'bg-violet-100 text-violet-700', value: 'text-violet-700' },
  rose: { card: 'border-rose-200 bg-gradient-to-br from-rose-50 to-white', icon: 'bg-rose-100 text-rose-600', value: 'text-rose-600' },
};

const TAKEAWAYS = [
  <>Q4 has the highest revenue at <b>₹165 Cr</b>, with growth of <b>26.9%</b>.</>,
  <>Q1 saw a decline of <b className="text-rose-600">₹10 Cr (−8.3%)</b> compared with Q1 FY24.</>,
  <>Q3 also saw a decline of <b className="text-rose-600">₹5 Cr (−5.0%)</b>.</>,
  <>H1 FY25 (Apr–Sep) totals <b>₹260 Cr</b>, up <b>3.8%</b> vs H1 FY24 (₹250 Cr).</>,
  <>H2 FY25 (Oct–Mar) totals <b>₹260 Cr</b>, up <b>8.3%</b> vs H2 FY24 (₹240 Cr).</>,
  <>Overall FY25 revenue increased by <b>6.1% (₹30 Cr)</b>, with strong recovery in Q4.</>,
];

export function RevenuePage() {
  const [report, setReport] = useState<SalesSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void reportApi.salesSummary().then(setReport).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center text-rose-600">{error}</div>;
  if (!report) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">Loading sales data…</div>;
  if (!report.periods.length) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">No sales data is available.</div>;
  return <LiveRevenue report={report} />;
}

function LiveRevenue({ report }: { report: SalesSummary }) {
  return <ReferenceRevenue report={report} />;
  /* Legacy compact layout retained below for comparison. */
  const values = report.periods.map((p) => p.amount_paise / 1_000_000_000);
  const total = report.total_paise / 1_000_000_000;
  const best = report.periods[values.indexOf(Math.max(...values))];
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: FONT }, tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${v.toFixed(2)} Cr` },
    grid: { left: 65, right: 25, top: 35, bottom: 55 },
    xAxis: { type: 'category', data: report.periods.map((p) => p.label), name: 'Billing period', nameLocation: 'middle', nameGap: 35, axisTick: { show: false } },
    yAxis: { type: 'value', name: 'Sales (₹ Cr)', nameLocation: 'middle', nameGap: 48, splitLine: { lineStyle: { color: '#dbe5f1', type: 'dashed' } } },
    series: [{ type: 'bar', barWidth: '45%', data: values, itemStyle: { borderRadius: [6,6,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#129bf3' }, { offset: 1, color: '#1554c5' }] } }, label: { show: true, position: 'top', formatter: ({ value }: { value: number }) => `₹${value.toFixed(2)} Cr`, color: '#172033', fontWeight: 700 } }],
  }), [report.periods, values]);
  return <div className="space-y-5"><header><div className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-teal-600">Revenue · Approved Sales Register</div><h1 className="font-heading text-4xl font-extrabold text-navy-900">{report.fy_label} sales are <span className="text-brand-600">₹{total.toFixed(2)} Cr</span></h1></header>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Total sales', `₹${total.toFixed(2)} Cr`], ['Billing rows', report.row_count.toLocaleString('en-IN')], ['Billing documents', report.billing_documents.toLocaleString('en-IN')], ['Strongest period', `${best.label} · ₹${(best.amount_paise/1_000_000_000).toFixed(2)} Cr`]].map(([label,value])=><div key={label} className="rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm"><div className="text-xs font-bold text-muted">{label}</div><div className="mt-1 font-heading text-xl font-extrabold text-blue-700">{value}</div></div>)}</div>
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm"><div className="bg-gradient-to-r from-navy-800 via-blue-700 to-cyan-500 px-5 py-3"><h2 className="font-heading text-xl font-bold text-white">Sales by Billing Period (₹ Crore)</h2></div><div className="h-[390px] p-3"><Chart option={option} className="h-full w-full" /></div></section>
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white p-4 shadow-sm"><h2 className="mb-3 font-heading text-lg font-bold text-navy-900">Period Details</h2><table className="w-full text-sm"><thead className="bg-navy-800 text-white"><tr><th className="p-2 text-left">Period</th><th>Sales (₹ Cr)</th><th>Units</th><th>Share</th></tr></thead><tbody>{report.periods.map((p)=><tr key={p.label} className="border-b border-sky-100 even:bg-sky-50/70"><td className="p-2 font-semibold">{p.label}</td><td className="text-center">{(p.amount_paise/1_000_000_000).toFixed(2)}</td><td className="text-center">{p.units.toLocaleString('en-IN')}</td><td className="text-center">{(p.amount_paise*100/report.total_paise).toFixed(1)}%</td></tr>)}</tbody></table></section>
  </div>;
}

function ReferenceRevenue({ report }: { report: SalesSummary }) {
  const values = report.periods.map(p => p.amount_paise / 1e9);
  const total = report.total_paise / 1e9;
  const best = report.periods[values.indexOf(Math.max(...values))];
  const option = useMemo<EChartsCoreOption>(() => ({ textStyle:{fontFamily:FONT}, tooltip:{trigger:'axis',valueFormatter:(v:number)=>`₹${v.toFixed(2)} Cr`}, grid:{left:65,right:25,top:38,bottom:52}, xAxis:{type:'category',data:report.periods.map(p=>p.label),axisTick:{show:false}}, yAxis:{type:'value',name:'Revenue (₹ Crore)',nameLocation:'middle',nameGap:48,splitLine:{lineStyle:{color:'#dbeafe',type:'dashed'}}}, series:[{type:'bar',barWidth:'52%',data:values,itemStyle:{borderRadius:[7,7,0,0],color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:'#11a8f4'},{offset:1,color:'#1554c5'}]}},label:{show:true,position:'top',formatter:({value}:{value:number})=>`₹${value.toFixed(2)}`,fontWeight:800,color:'#172033'}}] }),[report.periods,values]);
  const cards = [['Total Revenue',`₹${total.toFixed(2)} Cr`,'emerald'],['Billing Rows',report.row_count.toLocaleString('en-IN'),'blue'],['Documents',report.billing_documents.toLocaleString('en-IN'),'orange'],['Strongest Period',best.label,'violet'],['Peak Revenue',`₹${(best.amount_paise/1e9).toFixed(2)} Cr`,'rose']];
  const tones:Record<string,string>={emerald:'border-emerald-200 from-emerald-50 text-emerald-700',blue:'border-blue-200 from-blue-50 text-blue-700',orange:'border-orange-200 from-orange-50 text-orange-600',violet:'border-violet-200 from-violet-50 text-violet-700',rose:'border-rose-200 from-rose-50 text-rose-600'};
  return <div className="space-y-5"><header><div className="text-xs font-bold uppercase tracking-[.22em] text-teal-600">Revenue · Quarterly · Half-yearly · Yearly</div><h1 className="font-heading text-4xl font-extrabold text-navy-900">{report.fy_label} revenue is <span className="text-brand-600">₹{total.toFixed(2)} Cr</span></h1><p className="mt-2 rounded-xl border-l-4 border-teal-500 bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-2 text-sm"><b>In plain words:</b> Revenue is calculated directly from the uploaded Sales Register.</p></header><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{cards.map(([label,value,tone])=><div key={label} className={`rounded-2xl border bg-gradient-to-br to-white p-4 shadow-sm ${tones[tone]}`}><div className="text-xs font-bold text-ink">{label}</div><div className="mt-2 font-heading text-xl font-extrabold">{value}</div></div>)}</div><section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm"><div className="bg-gradient-to-r from-navy-900 via-blue-700 to-cyan-500 px-5 py-3 text-xl font-bold text-white">Revenue by Billing Period (₹ Crore)</div><div className="h-[390px] p-3"><Chart option={option} className="h-full w-full" /></div></section><div className="grid gap-5 lg:grid-cols-5"><section className="overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-violet-50 p-4 shadow-sm lg:col-span-3"><h2 className="mb-3 text-lg font-bold">Revenue Details</h2><table className="w-full text-sm"><thead className="bg-gradient-to-r from-cyan-700 via-blue-600 to-violet-600 text-white"><tr><th className="p-2 text-left">Period</th><th>Revenue (₹ Cr)</th><th>Units</th><th>Share</th></tr></thead><tbody>{report.periods.map(p=><tr key={p.label} className="border-b border-sky-100 even:bg-sky-50"><td className="p-2 font-bold">{p.label}</td><td className="text-center">{(p.amount_paise/1e9).toFixed(2)}</td><td className="text-center">{p.units.toLocaleString('en-IN')}</td><td className="text-center font-bold">{(p.amount_paise*100/report.total_paise).toFixed(1)}%</td></tr>)}</tbody></table></section><section className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-white to-blue-50 p-4 shadow-sm lg:col-span-2"><h2 className="mb-3 text-lg font-bold">💡 Key Takeaways</h2><ol className="space-y-3 text-sm"><li className="rounded-xl bg-white p-3"><b>1.</b> Total revenue is ₹{total.toFixed(2)} Cr.</li><li className="rounded-xl bg-emerald-50 p-3"><b>2.</b> {best.label} is strongest at ₹{(best.amount_paise/1e9).toFixed(2)} Cr.</li><li className="rounded-xl bg-violet-50 p-3"><b>3.</b> {report.billing_documents.toLocaleString('en-IN')} documents are included.</li></ol></section></div></div>;
}

export function StaticRevenuePage() {
  return (
    <div className="space-y-5">
      <header>
        <div className="mb-1 text-xs font-bold uppercase tracking-[0.2em] text-teal-600">Revenue · Quarterly · Half-yearly · Yearly</div>
        <h1 className="font-heading text-4xl font-extrabold text-navy-900">FY25 revenue up <span className="text-brand-600">6.1%</span> on FY24</h1>
        <p className="mt-2 rounded-lg border-l-4 border-teal-500 bg-gradient-to-r from-teal-50 to-cyan-50 px-4 py-2 text-sm text-navy-800"><b>In plain words:</b> Q1 to Q4 are three-month quarters. FY25 runs April 2024 to March 2025.</p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {KPI.map((item) => <KpiCard key={item.label} item={item} />)}
      </div>

      <RevenueChart />

      <div className="grid gap-5 lg:grid-cols-5">
        <RevenueTable />
        <Takeaways />
      </div>
    </div>
  );
}

function RevenueChart() {
  const option = useMemo<EChartsCoreOption>(() => ({
    textStyle: { fontFamily: FONT },
    color: ['#10b981', '#1479ed'],
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: (v: number) => `₹${v} Cr` },
    legend: { top: 8, right: 18, itemWidth: 18, itemHeight: 12, textStyle: { color: '#172033', fontWeight: 700 } },
    grid: { left: 66, right: 28, top: 100, bottom: 54 },
    xAxis: { type: 'category', data: QUARTERS, name: 'Quarter', nameLocation: 'middle', nameGap: 34, nameTextStyle: { fontWeight: 700 }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#cbd5e1' } }, axisLabel: { color: '#172033', fontWeight: 700 } },
    yAxis: { type: 'value', min: 0, max: 200, interval: 20, name: 'Revenue (₹ Crore)', nameLocation: 'middle', nameGap: 48, nameTextStyle: { fontWeight: 700 }, splitLine: { lineStyle: { color: '#dbe5f1', type: 'dashed' } } },
    series: [
      {
        name: 'FY24', type: 'bar', data: FY24, barWidth: '28%',
        itemStyle: { borderRadius: [6, 6, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#12d6a0' }, { offset: 1, color: '#0f9488' }] } },
        label: { show: true, position: 'top', color: '#172033', fontSize: 13, fontWeight: 800 },
      },
      {
        name: 'FY25', type: 'bar', data: FY25, barWidth: '28%',
        itemStyle: { borderRadius: [6, 6, 0, 0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#129bf3' }, { offset: 1, color: '#1554c5' }] } },
        label: { show: true, position: 'top', color: '#172033', fontSize: 13, fontWeight: 800 },
      },
      {
        name: 'Quarterly change annotations',
        type: 'custom',
        silent: true,
        clip: false,
        tooltip: { show: false },
        data: QUARTERS.map((_, i) => [i, FY24[i], FY25[i], CHANGES[i], GROWTH[i]]),
        renderItem: (_params: unknown, api: any) => {
          const quarter = api.value(0) as number;
          const oldValue = api.value(1) as number;
          const newValue = api.value(2) as number;
          const change = api.value(3) as number;
          const growth = api.value(4) as number;
          const oldPoint = api.coord([quarter, oldValue]);
          const newPoint = api.coord([quarter, newValue]);
          const bandWidth = api.size([1, 0])[0];
          const oldX = oldPoint[0] - bandWidth * 0.15;
          const newX = newPoint[0] + bandWidth * 0.15;
          const bracketY = Math.min(oldPoint[1], newPoint[1]) - 22;
          const positive = change > 0;
          const color = positive ? '#059669' : '#ef233c';
          const background = positive ? '#d1fae5' : '#fee2e2';
          const label = `${positive ? '+' : '−'}${Math.abs(change)} Cr\n(${positive ? '+' : '−'}${Math.abs(growth).toFixed(1)}%)`;
          const arrowTipY = newPoint[1] - 5;

          return {
            type: 'group',
            children: [
              {
                type: 'polyline',
                shape: { points: [[oldX, oldPoint[1] - 5], [oldX, bracketY], [newX, bracketY], [newX, arrowTipY - 5]] },
                style: { stroke: color, lineWidth: 2, fill: 'none', lineJoin: 'round' },
              },
              {
                type: 'polygon',
                shape: { points: [[newX, arrowTipY], [newX - 5, arrowTipY - 8], [newX + 5, arrowTipY - 8]] },
                style: { fill: color },
              },
              {
                type: 'rect',
                shape: { x: oldPoint[0] - 44, y: bracketY - 49, width: 88, height: 40, r: 8 },
                style: { fill: background, stroke: positive ? '#a7f3d0' : '#fecaca', lineWidth: 1 },
              },
              {
                type: 'text',
                style: { x: oldPoint[0], y: bracketY - 29, text: label, fill: color, font: `800 12px ${FONT}`, textAlign: 'center', textVerticalAlign: 'middle', lineHeight: 15 },
              },
            ],
          };
        },
        z: 20,
      },
    ],
  }), []);

  return (
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-white shadow-sm">
      <div className="bg-gradient-to-r from-navy-800 via-blue-700 to-cyan-500 px-5 py-3">
        <h2 className="font-heading text-xl font-bold text-white">Quarterly Revenue Comparison (₹ Crore)</h2>
      </div>
      <div className="h-[390px] p-2"><Chart option={option} className="h-full w-full" /></div>
    </section>
  );
}

function KpiCard({ item }: { item: (typeof KPI)[number] }) {
  const tone = TONES[item.tone];
  return (
    <div className={`min-w-0 rounded-2xl border p-3 shadow-sm ${tone.card}`}>
      <div className="flex items-center gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full ${tone.icon}`}><Glyph name={item.icon} /></span>
        <div className="min-w-0">
          <div className="truncate text-xs font-bold text-ink">{item.label}</div>
          <div className={`truncate font-heading text-xl font-extrabold ${tone.value}`}>{item.value}</div>
          {'note' in item && item.note && <div className={`text-xs font-bold ${tone.value}`}>{item.note}</div>}
        </div>
      </div>
    </div>
  );
}

function RevenueTable() {
  return (
    <section className="overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50/80 via-white to-violet-50/50 p-4 shadow-sm lg:col-span-3">
      <h2 className="mb-3 font-heading text-lg font-bold text-navy-900">▥ &nbsp; Quarterly Revenue Details (₹ Crore)</h2>
      <table className="w-full border-collapse text-sm">
        <thead className="text-white"><tr>
          <th className="rounded-l-lg bg-gradient-to-b from-cyan-600 to-cyan-700 p-2">Quarter</th>
          <th className="bg-gradient-to-b from-teal-500 to-teal-600 p-2">FY24 Revenue<br />(₹ Cr)</th>
          <th className="bg-gradient-to-b from-blue-500 to-blue-700 p-2">FY25 Revenue<br />(₹ Cr)</th>
          <th className="bg-gradient-to-b from-orange-400 to-orange-600 p-2">Change<br />(₹ Cr)</th>
          <th className="rounded-r-lg bg-gradient-to-b from-violet-500 to-violet-700 p-2">YoY Growth<br />(%)</th>
        </tr></thead>
        <tbody>
          {QUARTERS.map((quarter, i) => <tr key={quarter} className="border-b border-sky-100 odd:bg-white even:bg-sky-50/80 text-center">
            <td className="p-2 text-left font-bold">{quarter} {['(Apr – Jun)', '(Jul – Sep)', '(Oct – Dec)', '(Jan – Mar)'][i]}</td>
            <td className="p-2 tabular-nums">{FY24[i]}</td><td className="p-2 tabular-nums">{FY25[i]}</td>
            <td className={`p-2 font-bold ${CHANGES[i] > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{CHANGES[i] > 0 ? '+' : ''}{CHANGES[i]}</td>
            <td className={`p-2 font-bold ${GROWTH[i] > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{GROWTH[i] > 0 ? '+' : ''}{GROWTH[i].toFixed(1)}%</td>
          </tr>)}
          <tr className="bg-emerald-100/80 text-center font-extrabold text-navy-900"><td className="p-2 text-left">Total (Q1–Q4)</td><td>490</td><td>520</td><td className="text-emerald-700">+30</td><td className="text-emerald-700">+6.1%</td></tr>
        </tbody>
      </table>
    </section>
  );
}

function Takeaways() {
  const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-orange-500', 'bg-violet-500', 'bg-rose-500', 'bg-teal-500'];
  return (
    <section className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50/80 via-white to-blue-50/80 p-4 shadow-sm lg:col-span-2">
      <h2 className="mb-3 font-heading text-lg font-bold text-navy-900">💡 Key Takeaways</h2>
      <ol className="space-y-2">
        {TAKEAWAYS.map((text, i) => <li key={i} className="flex items-start gap-3 rounded-xl border border-white bg-white/70 p-2.5 text-sm text-ink shadow-sm">
          <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-bold text-white ${colors[i]}`}>{i + 1}</span><span>{text}</span>
        </li>)}
      </ol>
    </section>
  );
}

function Glyph({ name }: { name: string }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'coins') return <svg {...p}><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>;
  if (name === 'bars') return <svg {...p}><path d="M4 20V13M10 20V8M16 20V3M22 20H2" /></svg>;
  if (name === 'trend') return <svg {...p}><path d="M3 17l6-6 4 4 8-8m0 0h-5m5 0v5" /></svg>;
  return <svg {...p}><path d="M3 7l6 6 4-4 8 8m0 0v-5m0 5h-5" /></svg>;
}
