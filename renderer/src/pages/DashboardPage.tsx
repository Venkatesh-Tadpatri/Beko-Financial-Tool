import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EChartsCoreOption } from 'echarts';
import { reportApi, type SalesSummary } from '../api/data';
import { Chart } from '../components/Chart';

/* ------------------------------------------------------------------ palette */
// Chart colours. Text stays on ink/muted; marks carry identity.
const INK = '#172033';
const MUTED = '#5b6678';
const LINE = '#e3e7ef';
const BRAND = '#2453d4';
const BRAND_LIGHT = '#8fb4f6';
const POS = '#16a34a';
const NEG = '#dc2626';
const AQUA = '#1baf7a';
// Validated categorical palette (dataviz skill) for the product donut.
const DONUT = ['#2a78d6', '#1baf7a', '#eda100', '#eb6834', '#e87ba4'];
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";

/* --------------------------------------------------------- placeholder data */
// Static for now; the next step maps these to the approved-data API.
const FY = { label: 'FY25', range: 'Apr 2024 – Mar 2025' };

const KPIS = [
  { key: 'sales', label: 'Total Sales', icon: 'bars', tint: 'brand', value: '₹517 Cr', delta: '+16.8%', dir: 'up', sub: 'vs FY24 (₹443 Cr)', spark: [320, 350, 380, 410, 450, 486] },
  { key: 'fcf', label: 'Free Cash Flow', icon: 'cash', tint: 'green', value: '₹140 Cr', delta: '+100%', dir: 'up', sub: 'vs FY22 (₹70 Cr)', spark: [60, 70, 85, 100, 120, 140] },
  { key: 'dso', label: 'DSO (Receivable Days)', icon: 'doc', tint: 'red', value: '42 days', delta: '-3 days', dir: 'down-good', sub: 'vs FY24 (45 days)', spark: [52, 50, 48, 46, 45, 42] },
  { key: 'roe', label: 'ROE', icon: 'target', tint: 'violet', value: '25.0%', delta: '+6.0 pp', dir: 'up', sub: 'vs FY20 (19.0%)', spark: [19, 20, 21, 22, 24, 25] },
] as const;

const TREND = {
  actual: [320, 350, 380, 410, 450, 486],
  forecast: [300, 340, 390, 400, 430, 450],
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const VARIANCE = [20, 10, -10, 10, 20, 36];
const VARIANCE_PCT = ['+6.7%', '+2.9%', '-2.6%', '+2.5%', '+4.7%', '+8.0%'];

const PRODUCTS = [
  { name: 'Product A', share: 35, delta: '+5 pp', dir: 'up' },
  { name: 'Product B', share: 25, delta: '+3 pp', dir: 'up' },
  { name: 'Product C', share: 20, delta: '-2 pp', dir: 'down' },
  { name: 'Product D', share: 12, delta: '0 pp', dir: 'flat' },
  { name: 'Others', share: 8, delta: '-1 pp', dir: 'down' },
] as const;

const OPERATING = { years: ['FY21', 'FY22', 'FY23', 'FY24', 'FY25'], values: [52, 64, 72, 78, 92] };
const ORDER_BOOK = { years: ['FY21', 'FY22', 'FY23', 'FY24', 'FY25'], values: [310, 420, 460, 506, 620] };

const HIGHLIGHTS = [
  { icon: 'up', tint: 'green', title: 'Revenue Growth', body: 'Total sales increased by 16.8% from ₹443 Cr to ₹517 Cr.' },
  { icon: 'trophy', tint: 'blue', title: 'Strong Cash Flow', body: 'Free cash flow doubled to ₹140 Cr (vs ₹70 Cr in FY22).' },
  { icon: 'stack', tint: 'violet', title: 'Improved Receivables', body: 'DSO reduced by 3 days to 42 days (vs 45 days in FY24).' },
  { icon: 'bars', tint: 'amber', title: 'Higher Returns', body: 'ROE improved to 25.0%, up 6.0 percentage points from FY20.' },
] as const;

/* ---------------------------------------------------------------- component */

export function DashboardPage() {
  const [report, setReport] = useState<SalesSummary | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { void reportApi.salesSummary().then(setReport).catch((e: Error) => setError(e.message)); }, []);
  if (error) return <div className="rounded-2xl border border-rose-200 bg-white p-8 text-center text-rose-600">{error}</div>;
  if (!report) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">Loading sales data…</div>;
  if (!report.periods.length) return <div className="rounded-2xl border border-sky-200 bg-white p-8 text-center text-muted">No sales data is available. Upload and import a Sales Register file.</div>;
  return <LiveDashboard report={report} />;
}

function LiveDashboard({ report }: { report: SalesSummary }) {
  return <ReferenceDashboard report={report} />;
  /* Legacy compact layout retained below for comparison. */
  const periodValues = report.periods.map((p) => p.amount_paise / 1_000_000_000);
  const products = report.products.slice(0, 6);
  const totalCr = report.total_paise / 1_000_000_000;
  const trend = useMemo<EChartsCoreOption>(() => ({ textStyle: { fontFamily: FONT }, tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${v.toFixed(2)} Cr` }, grid: { left: 55, right: 20, top: 30, bottom: 45 }, xAxis: { type: 'category', data: report.periods.map((p) => p.label), axisTick: { show: false } }, yAxis: { type: 'value', name: '₹ Cr', splitLine: { lineStyle: { color: LINE } } }, series: [{ type: 'line', smooth: true, symbolSize: 9, data: periodValues, lineStyle: { color: BRAND, width: 3 }, itemStyle: { color: BRAND }, areaStyle: { color: 'rgba(36,83,212,.1)' }, label: { show: true, position: 'top', formatter: ({ value }: { value: number }) => value.toFixed(2), fontWeight: 700 } }] }), [report.periods, periodValues]);
  const donut = useMemo<EChartsCoreOption>(() => ({ tooltip: { trigger: 'item', formatter: '{b}: {d}%' }, color: DONUT, series: [{ type: 'pie', radius: ['48%','78%'], label: { show: true, position: 'inside', formatter: '{d}%', color: '#fff', fontSize: 10, fontWeight: 700 }, data: products.map((p) => ({ name: p.name, value: p.amount_paise })) }] }), [products]);
  const cards = [['Total Sales', `₹${totalCr.toFixed(2)} Cr`], ['Units Sold', report.total_units.toLocaleString('en-IN')], ['Billing Documents', report.billing_documents.toLocaleString('en-IN')], ['Products', report.products.length.toLocaleString('en-IN')]];
  return <div className="space-y-5"><div><div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Executive Dashboard · Live Approved Data</div><h1 className="mt-1 font-heading text-3xl font-bold text-navy-900">{report.fy_label} quarterly sales overview</h1></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value])=><div key={label} className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm"><div className="text-sm font-semibold text-muted">{label}</div><div className="mt-2 font-heading text-2xl font-bold text-brand-600">{value}</div></div>)}</div><div className="grid gap-4 xl:grid-cols-3"><Panel title="Sales Trend (₹ Cr)" icon="bars" className="xl:col-span-2"><Chart option={trend} className="h-[310px] w-full" /></Panel><Panel title="Sales by Product, Share %" icon="pie"><div className="relative h-48"><Chart option={donut} className="h-full w-full" /></div><ul className="mt-3 space-y-2">{products.map((p,i)=><li key={p.name} className="flex items-center gap-2 text-sm"><span className="h-2.5 w-2.5 rounded-full" style={{background:DONUT[i%DONUT.length]}}/><span className="min-w-0 flex-1 truncate">{p.name}</span><b>{p.share.toFixed(1)}%</b></li>)}</ul></Panel></div><div className="grid gap-4 xl:grid-cols-2"><Panel title="Sales Channels" icon="stack"><RankedList items={report.channels} total={report.total_paise}/></Panel><Panel title="Top Customers" icon="doc"><RankedList items={report.customers.slice(0,8)} total={report.total_paise}/></Panel></div></div>;
}

function ReferenceDashboard({ report }: { report: SalesSummary }) {
  const values = report.periods.map(p => p.amount_paise / 1e9);
  const total = report.total_paise / 1e9;
  const products = report.products.slice(0, 5);
  const best = report.periods[values.indexOf(Math.max(...values))];
  const trend = useMemo<EChartsCoreOption>(() => ({ textStyle:{fontFamily:FONT},tooltip:{trigger:'axis',valueFormatter:(v:number)=>`₹${v.toFixed(2)} Cr`},grid:{left:58,right:20,top:35,bottom:45},xAxis:{type:'category',data:report.periods.map(p=>p.label),axisTick:{show:false}},yAxis:{type:'value',name:'₹ Cr',splitLine:{lineStyle:{color:'#dbeafe',type:'dashed'}}},series:[{type:'line',smooth:true,symbolSize:9,data:values,lineStyle:{color:'#1479ed',width:4},itemStyle:{color:'#1479ed'},areaStyle:{color:'rgba(20,121,237,.12)'},label:{show:true,position:'top',formatter:({value}:{value:number})=>value.toFixed(2),fontWeight:800}}] }),[report.periods,values]);
  const donut = useMemo<EChartsCoreOption>(() => ({color:DONUT,tooltip:{trigger:'item',formatter:'{b}: {d}%'},series:[{type:'pie',radius:['48%','78%'],label:{show:true,position:'inside',formatter:'{d}%',color:'#fff',fontWeight:800},data:products.map(p=>({name:p.name,value:p.amount_paise}))}]}),[products]);
  const cards = [
    ['Total Sales',`₹${total.toFixed(2)} Cr`,'bg-gradient-to-br from-blue-50 to-white border-blue-200 text-blue-700'],
    ['Units Sold',report.total_units.toLocaleString('en-IN'),'bg-gradient-to-br from-emerald-50 to-white border-emerald-200 text-emerald-700'],
    ['Billing Documents',report.billing_documents.toLocaleString('en-IN'),'bg-gradient-to-br from-rose-50 to-white border-rose-200 text-rose-600'],
    ['Products',report.products.length.toLocaleString('en-IN'),'bg-gradient-to-br from-violet-50 to-white border-violet-200 text-violet-700'],
  ];
  return <div className="space-y-5"><header className="flex flex-wrap items-start justify-between gap-4"><div><div className="text-xs font-bold uppercase tracking-[.24em] text-navy-700">Executive Dashboard</div><h1 className="font-heading text-4xl font-extrabold text-navy-900">Strong sales performance from uploaded data</h1></div><div className="rounded-xl border border-blue-200 bg-white px-4 py-3 font-bold text-navy-900 shadow-sm">{report.fy_label}</div></header><p className="rounded-xl border-l-4 border-emerald-500 bg-gradient-to-r from-emerald-50 to-cyan-50 px-4 py-3 text-sm"><b>▥ In plain words:</b> Total sales are <b className="text-emerald-700">₹{total.toFixed(2)} Cr</b>; the strongest period is <b>{best.label}</b>, and all visuals use the latest database import.</p><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label,value,tone])=><div key={label} className={`rounded-2xl border p-5 shadow-sm ${tone}`}><div className="text-sm font-bold text-navy-900">{label}</div><div className="mt-3 font-heading text-3xl font-extrabold">{value}</div></div>)}</div><div className="grid gap-4 xl:grid-cols-3"><Panel title="Sales Trend (₹ Cr)" icon="bars" className="xl:col-span-2"><Chart option={trend} className="h-[320px] w-full" /></Panel><Panel title="Sales by Product, Share %" icon="pie"><div className="relative h-52"><Chart option={donut} className="h-full w-full" /><div className="pointer-events-none absolute inset-0 grid place-items-center"><div className="text-center"><b className="text-lg text-navy-900">₹{total.toFixed(1)} Cr</b><div className="text-xs text-muted">Total Sales</div></div></div></div><ul className="space-y-2">{products.map((p,i)=><li key={p.name} className="flex items-center gap-2 text-sm"><span className="h-3 w-3 rounded-full" style={{background:DONUT[i]}}/><span className="flex-1 truncate">{p.name}</span><b>{p.share.toFixed(1)}%</b></li>)}</ul></Panel></div><div className="grid gap-4 xl:grid-cols-3"><Panel title="Sales Channels" icon="stack" tint="blue"><RankedList items={report.channels} total={report.total_paise}/></Panel><Panel title="Top Customers" icon="doc" tint="green"><RankedList items={report.customers.slice(0,6)} total={report.total_paise}/></Panel><Panel title="Key Highlights" icon="bulb" tint="amber"><div className="space-y-3 text-sm"><div className="rounded-xl bg-emerald-50 p-3"><b>Revenue:</b> ₹{total.toFixed(2)} Cr</div><div className="rounded-xl bg-blue-50 p-3"><b>Best period:</b> {best.label}</div><div className="rounded-xl bg-violet-50 p-3"><b>Transactions:</b> {report.row_count.toLocaleString('en-IN')}</div><div className="rounded-xl bg-orange-50 p-3"><b>Products:</b> {report.products.length}</div></div></Panel></div></div>;
}

function RankedList({ items, total }: { items: SalesSummary['channels']; total: number }) { return <div className="space-y-3">{items.map((item)=><div key={item.name}><div className="mb-1 flex justify-between gap-4 text-sm"><span className="truncate">{item.name}</span><b>{(item.amount_paise/1_000_000_000).toFixed(2)} Cr</b></div><div className="h-2 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-gradient-to-r from-blue-700 to-cyan-500" style={{width:`${total ? item.amount_paise*100/total : 0}%`}}/></div></div>)}</div>; }

export function StaticDashboardPage() {
  return (
    <div className="space-y-5">
      <Header />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map((k) => (
          <KpiTile key={k.key} item={k} />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Sales Trend (₹ Cr)" icon="bars" className="xl:col-span-2" legend={<TrendLegend />}>
          <SalesTrend />
        </Panel>
        <Panel title="Sales by Product, Share %" icon="pie">
          <ProductMix />
        </Panel>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Operating Profit (₹ Cr)" icon="bars" tint="blue">
          <HeadlineBars data={OPERATING} value="₹92 Cr" delta="+18.1%" sub="vs FY24 (₹78 Cr)" color={BRAND} />
        </Panel>
        <Panel title="Order Book (₹ Cr)" icon="doc" tint="green">
          <HeadlineBars data={ORDER_BOOK} value="₹620 Cr" delta="+22.5%" sub="vs FY24 (₹506 Cr)" color={AQUA} />
        </Panel>
        <Panel title="Key Highlights" icon="bulb" tint="amber">
          <Highlights />
        </Panel>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- sections */

function Header() {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">Executive Dashboard</div>
        <h1 className="mt-1 font-heading text-3xl font-bold text-navy-900">Strong growth and healthy cash position</h1>
      </div>
      <button
        type="button"
        className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-ink shadow-sm hover:bg-canvas"
      >
        <Icon name="calendar" className="h-4 w-4 text-brand-600" />
        <span>{FY.label}</span>
        <span className="font-normal text-muted">({FY.range})</span>
        <Icon name="chevron" className="h-4 w-4 text-muted" />
      </button>
    </div>
  );
}

// Soft tinted card backgrounds per KPI, matching the reference design.
const CARD: Record<string, { bg: string; icon: string }> = {
  brand: { bg: 'bg-gradient-to-br from-blue-50 to-white border-blue-100', icon: 'bg-blue-100 text-blue-600' },
  green: { bg: 'bg-gradient-to-br from-emerald-50 to-white border-emerald-100', icon: 'bg-emerald-100 text-emerald-600' },
  red: { bg: 'bg-gradient-to-br from-rose-50 to-white border-rose-100', icon: 'bg-rose-100 text-rose-600' },
  violet: { bg: 'bg-gradient-to-br from-violet-50 to-white border-violet-100', icon: 'bg-violet-100 text-violet-600' },
};

const TINTS: Record<string, string> = {
  brand: 'bg-brand-50 text-brand-600',
  green: 'bg-emerald-50 text-emerald-600',
  red: 'bg-red-50 text-red-600',
  violet: 'bg-violet-50 text-violet-600',
  blue: 'bg-brand-50 text-brand-600',
  amber: 'bg-amber-50 text-amber-600',
};

function KpiTile({ item: { label, icon, tint, value, delta, dir, sub, spark } }: { item: (typeof KPIS)[number] }) {
  const up = dir === 'up' || dir === 'down-good';
  const option = useMemo(() => sparkOption(spark as unknown as number[], up ? POS : NEG), [spark, up]);
  const card = CARD[tint];
  return (
    <div className={`rounded-2xl border p-5 shadow-sm ${card.bg}`}>
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${card.icon}`}>
          <Icon name={icon} className="h-5 w-5" />
        </span>
        <span className="text-sm font-semibold text-muted">{label}</span>
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div>
          <div className="font-heading text-[28px] font-bold leading-none text-navy-900">{value}</div>
          <div className={`mt-2 flex items-center gap-1 text-sm font-semibold ${up ? 'text-emerald-600' : 'text-red-600'}`}>
            <Icon name={up ? 'triangleUp' : 'triangleDown'} className="h-3 w-3" />
            {delta}
          </div>
        </div>
        <Chart option={option} className="h-10 w-20" />
      </div>
      <div className="mt-2 text-xs text-muted">{sub}</div>
    </div>
  );
}

const PANEL: Record<string, { bg: string; icon: string }> = {
  white: { bg: 'border-line bg-white', icon: 'bg-brand-50 text-brand-600' },
  blue: { bg: 'border-blue-100 bg-gradient-to-br from-blue-50 to-white', icon: 'bg-blue-100 text-blue-600' },
  green: { bg: 'border-emerald-100 bg-gradient-to-br from-emerald-50 to-white', icon: 'bg-emerald-100 text-emerald-600' },
  amber: { bg: 'border-amber-100 bg-gradient-to-br from-amber-50 to-white', icon: 'bg-amber-100 text-amber-600' },
};

function Panel({ title, icon, children, className = '', legend, tint = 'white' }: { title: string; icon: string; children: ReactNode; className?: string; legend?: ReactNode; tint?: keyof typeof PANEL }) {
  const p = PANEL[tint];
  return (
    <section className={`overflow-hidden rounded-2xl border p-5 shadow-sm ${p.bg} ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`grid h-7 w-7 place-items-center rounded-lg ${p.icon}`}>
            <Icon name={icon} className="h-4 w-4" />
          </span>
          <h2 className="font-heading text-base font-semibold text-navy-900">{title}</h2>
        </div>
        {legend}
      </div>
      {children}
    </section>
  );
}

function TrendLegend() {
  return (
    <div className="flex items-center gap-4 text-xs text-muted">
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: BRAND }} />Actual</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: BRAND_LIGHT }} />Forecast</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: POS }} />Variance</span>
    </div>
  );
}

function SalesTrend() {
  const option = useMemo<EChartsCoreOption>(
    () => ({
      textStyle: { fontFamily: FONT },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${v} Cr`, backgroundColor: '#fff', borderColor: LINE, textStyle: { color: INK } },
      // Grid 0 = variance band on TOP (above the 600 line); grid 1 = line chart below it.
      grid: [
        { left: 64, right: 16, top: 34, height: 64 },
        { left: 64, right: 16, top: 128, height: 150 },
      ],
      xAxis: [
        { type: 'category', data: MONTHS, gridIndex: 0, show: false, boundaryGap: true },
        { type: 'category', data: MONTHS, gridIndex: 1, boundaryGap: true, axisTick: { show: false }, axisLine: { show: false }, axisLabel: { show: false } },
      ],
      yAxis: [
        // Variance band: zero line sits near the bottom so bars sit high in the band; -10 just dips below.
        { type: 'value', gridIndex: 0, min: -14, max: 42, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false } },
        {
          type: 'value', gridIndex: 1, min: 0, max: 600, splitNumber: 3, axisLabel: { color: MUTED }, splitLine: { lineStyle: { color: LINE } },
          name: 'Sales (₹ Cr)', nameLocation: 'middle', nameRotate: 90, nameGap: 40, nameTextStyle: { color: MUTED, fontSize: 11, fontWeight: 600 },
        },
      ],
      series: [
        {
          name: 'Forecast', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: TREND.forecast,
          lineStyle: { type: 'dashed', width: 2, color: BRAND_LIGHT }, itemStyle: { color: BRAND_LIGHT }, symbol: 'circle', symbolSize: 7,
          label: { show: true, position: 'bottom', color: BRAND_LIGHT, fontWeight: 600 },
        },
        {
          name: 'Actual', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: TREND.actual,
          lineStyle: { width: 3, color: BRAND }, itemStyle: { color: BRAND }, symbol: 'circle', symbolSize: 8,
          label: { show: true, position: 'top', color: INK, fontWeight: 700 },
          areaStyle: { color: 'rgba(36,83,212,0.06)' },
        },
        {
          name: 'Variance', type: 'bar', xAxisIndex: 0, yAxisIndex: 0, barWidth: 22,
          // Each bar grows from the zero line: flat base on the line, rounded outer end only.
          data: VARIANCE.map((v) => ({
            value: v,
            itemStyle: { color: v < 0 ? NEG : POS, borderRadius: v < 0 ? [0, 0, 4, 4] : [4, 4, 0, 0] },
          })),
          // Dashed zero baseline the bars sit on.
          markLine: {
            symbol: 'none', silent: true, data: [{ yAxis: 0 }],
            lineStyle: { type: 'dashed', color: LINE, width: 1 }, label: { show: false },
          },
          label: {
            show: true, position: 'top', fontWeight: 700,
            color: (p: { value: number }) => (p.value < 0 ? NEG : POS),
            formatter: (p: { value: number }) => (p.value >= 0 ? '+' : '') + p.value,
          },
        },
      ],
    }),
    [],
  );
  return (
    <div>
      <Chart option={option} className="h-[300px] w-full" />
      <div className="grid grid-cols-6 pl-[64px] pr-4 text-center text-[11px] font-medium">
        {VARIANCE_PCT.map((p, i) => (
          <span key={i} className={VARIANCE[i] < 0 ? 'text-red-600' : 'text-emerald-600'}>({p})</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-6 pl-[64px] pr-4 text-center text-xs font-medium text-muted">
        {MONTHS.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
      <div className="mt-1 pl-[64px] pr-4 text-center text-[11px] font-semibold text-muted">Months</div>
    </div>
  );
}

function ProductMix() {
  const option = useMemo<EChartsCoreOption>(
    () => ({
      textStyle: { fontFamily: FONT },
      tooltip: { trigger: 'item', formatter: '{b}: {d}%', backgroundColor: '#fff', borderColor: LINE, textStyle: { color: INK } },
      series: [
        {
          type: 'pie', radius: ['52%', '86%'], center: ['50%', '50%'], avoidLabelOverlap: true,
          itemStyle: { borderColor: '#fff', borderWidth: 3 },
          label: { show: true, position: 'inside', formatter: '{d}%', color: '#fff', fontWeight: 700, fontSize: 14 },
          data: PRODUCTS.map((p, i) => ({ name: p.name, value: p.share, itemStyle: { color: DONUT[i] } })),
        },
      ],
    }),
    [],
  );
  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative h-44 w-44 shrink-0">
        <Chart option={option} className="h-full w-full" />
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-heading text-base font-bold text-navy-900">₹486 Cr</div>
          <div className="text-[10px] leading-tight text-muted">Total Sales</div>
          <div className="text-[10px] leading-tight text-muted">FY25 (YTD)</div>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {PRODUCTS.map((p, i) => (
          <li key={p.name} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DONUT[i] }} />
            <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
            <span className="shrink-0 font-semibold text-navy-900">{p.share}%</span>
            <span className={`flex w-14 shrink-0 items-center justify-end gap-0.5 font-semibold ${p.dir === 'up' ? 'text-emerald-600' : p.dir === 'down' ? 'text-red-600' : 'text-muted'}`}>
              {p.dir === 'up' && <Icon name="triangleUp" className="h-2.5 w-2.5" />}
              {p.dir === 'down' && <Icon name="triangleDown" className="h-2.5 w-2.5" />}
              {p.delta}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeadlineBars({ data, value, delta, sub, color }: { data: { years: string[]; values: number[] }; value: string; delta: string; sub: string; color: string }) {
  const option = useMemo<EChartsCoreOption>(() => {
    const max = Math.max(...data.values);
    return {
      textStyle: { fontFamily: FONT },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `₹${v} Cr`, backgroundColor: '#fff', borderColor: LINE, textStyle: { color: INK } },
      grid: { left: 36, right: 12, top: 24, bottom: 48 },
      xAxis: {
        type: 'category', data: data.years, axisTick: { show: false }, axisLine: { lineStyle: { color: LINE } }, axisLabel: { color: MUTED },
        name: 'Financial Year', nameLocation: 'middle', nameGap: 30, nameTextStyle: { color: MUTED, fontSize: 11, fontWeight: 600 },
      },
      yAxis: {
        type: 'value', show: true, max: max * 1.15, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { show: false }, splitLine: { show: false },
        name: '₹ Cr', nameLocation: 'end', nameGap: 8, nameTextStyle: { color: MUTED, fontSize: 11, fontWeight: 600, align: 'left' },
      },
      series: [
        {
          type: 'bar', data: data.values.map((v, i) => ({ value: v, itemStyle: { color: i === data.values.length - 1 ? color : withAlpha(color, 0.55) } })),
          barWidth: '52%', itemStyle: { borderRadius: [4, 4, 0, 0] },
          label: { show: true, position: 'top', color: INK, fontWeight: 700, formatter: '{c} Cr' },
        },
      ],
    };
  }, [data, color]);
  return (
    <div>
      <div className="flex items-end gap-3">
        <div className="font-heading text-3xl font-bold text-navy-900">{value}</div>
        <div className="mb-1 flex items-center gap-1 text-sm font-semibold text-emerald-600">
          <Icon name="triangleUp" className="h-3 w-3" />
          {delta}
        </div>
      </div>
      <div className="text-xs text-muted">{sub}</div>
      <Chart option={option} className="mt-2 h-40 w-full" />
    </div>
  );
}

const ROW: Record<string, string> = {
  green: 'bg-emerald-50/70 border-emerald-100',
  blue: 'bg-blue-50/70 border-blue-100',
  violet: 'bg-violet-50/70 border-violet-100',
  amber: 'bg-amber-50/70 border-amber-100',
};

function Highlights() {
  return (
    <ul className="space-y-2.5">
      {HIGHLIGHTS.map((h) => (
        <li key={h.title} className={`flex items-start gap-3 rounded-xl border p-3 ${ROW[h.tint]}`}>
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${TINTS[h.tint]}`}>
            <Icon name={h.icon} className="h-4 w-4" />
          </span>
          <div>
            <div className="text-sm font-semibold text-navy-900">{h.title}</div>
            <div className="text-xs text-muted">{h.body}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ helpers */

function sparkOption(data: number[], color: string): EChartsCoreOption {
  return {
    grid: { left: 2, right: 2, top: 4, bottom: 2 },
    xAxis: { type: 'category', show: false, data: data.map((_, i) => i), boundaryGap: false },
    yAxis: { type: 'value', show: false, min: Math.min(...data) * 0.9, max: Math.max(...data) * 1.05 },
    series: [
      {
        type: 'bar', data, barWidth: '60%',
        itemStyle: { borderRadius: 2, color: withAlpha(color, 0.35) },
      },
    ],
  };
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function Icon({ name, className = '' }: { name: string; className?: string }) {
  const common = { className, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (name) {
    case 'bars':
      return (<svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>);
    case 'cash':
      return (<svg {...common}><rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /></svg>);
    case 'doc':
      return (<svg {...common}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /></svg>);
    case 'target':
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>);
    case 'pie':
      return (<svg {...common}><path d="M12 3a9 9 0 1 0 9 9h-9V3Z" /><path d="M12 3v9h9A9 9 0 0 0 12 3Z" /></svg>);
    case 'bulb':
      return (<svg {...common}><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.3 1 2.5h6c0-1.2.3-1.8 1-2.5A6 6 0 0 0 12 3Z" /></svg>);
    case 'trophy':
      return (<svg {...common}><path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5v1a3 3 0 0 0 3 3M16 6h3v1a3 3 0 0 1-3 3M10 17h4M9 21h6" /></svg>);
    case 'stack':
      return (<svg {...common}><path d="M12 3 3 8l9 5 9-5-9-5ZM3 13l9 5 9-5M3 18l9 5 9-5" /></svg>);
    case 'up':
      return (<svg {...common}><path d="M12 19V5M5 12l7-7 7 7" /></svg>);
    case 'calendar':
      return (<svg {...common}><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>);
    case 'chevron':
      return (<svg {...common}><path d="m6 9 6 6 6-6" /></svg>);
    case 'triangleUp':
      return (<svg className={className} viewBox="0 0 12 12" fill="currentColor"><path d="M6 2l4 7H2l4-7Z" /></svg>);
    case 'triangleDown':
      return (<svg className={className} viewBox="0 0 12 12" fill="currentColor"><path d="M6 10 2 3h8l-4 7Z" /></svg>);
    default:
      return null;
  }
}
