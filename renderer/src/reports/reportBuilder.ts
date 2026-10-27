/**
 * Historical reports: one spec per report (title, chart, tables, notes) that drives
 * the on-screen view and every export (PDF, PNG, Excel-readable CSV).
 */
import type { EChartsCoreOption } from 'echarts';
import type { HistoryYear } from '../api/data';
import { fyShort } from '../components/FyPicker';

export const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
export const QUARTERS = ['Q1 (Apr–Jun)', 'Q2 (Jul–Sep)', 'Q3 (Oct–Dec)', 'Q4 (Jan–Mar)'];
export const YEAR_COLORS = ['#1d6fe0', '#10a37f', '#f5a50b', '#7c3aed', '#e11d48', '#0ea5e9', '#f97316', '#64748b'];
const FONT = "'DM Sans', 'Segoe UI', system-ui, sans-serif";
const NAVY = '#0b1b4d';
const CRORE = 1_000_000_000;

export type MetricKey = 'revenue' | 'units' | 'invoices';
export const METRICS: Record<MetricKey, { label: string; short: string; unit: string; scale: (v: number) => number; digits: (v: number) => number }> = {
  revenue: { label: 'Revenue (₹ Cr)', short: 'Revenue', unit: '₹ Cr', scale: (v) => v / CRORE, digits: (v) => (Math.abs(v) >= 100 ? 0 : 2) },
  units: { label: 'Units sold', short: 'Units', unit: 'units', scale: (v) => v, digits: () => 0 },
  invoices: { label: 'Invoices (billing documents)', short: 'Invoices', unit: 'invoices', scale: (v) => v, digits: () => 0 },
};

export type ReportKey = 'monthly' | 'quarterly' | 'yoy' | 'trend' | 'annual';
export const REPORTS: { key: ReportKey; name: (m: MetricKey) => string; description: string }[] = [
  { key: 'monthly', name: (m) => `Monthly ${METRICS[m].short}`, description: 'Month-wise comparison for the selected years' },
  { key: 'quarterly', name: () => 'Quarterly Summary', description: 'Quarter-wise performance with growth %' },
  { key: 'yoy', name: () => 'Year on Year', description: 'Full-year comparison of the selected years' },
  { key: 'trend', name: () => 'Long-term Trend', description: 'Every year in the database, with CAGR' },
  { key: 'annual', name: () => 'Annual Review', description: 'Detailed performance report for the latest selected year' },
];

export interface ReportTable { title: string; head: string[]; rows: Cell[][]; note?: string }
export type Cell = string | { text: string; tone?: 'up' | 'down' | 'bold' | 'muted' };
export interface ReportSpec {
  key: ReportKey;
  title: string;
  subtitle: string;
  kpis: { label: string; value: string; sub?: string; tone?: 'up' | 'down' }[];
  chart: EChartsCoreOption;
  tables: ReportTable[];
  notes: string[];
}

/* ---------------------------------------------------------------- helpers */

export function fmt(metric: MetricKey, raw: number): string {
  const m = METRICS[metric];
  const v = m.scale(raw);
  return v.toLocaleString('en-IN', { maximumFractionDigits: m.digits(v) });
}
/** Like fmt, but a small non-zero amount shows as "<0.01" rather than "0". */
const fmtSmall = (metric: MetricKey, raw: number) => (raw > 0 && METRICS[metric].scale(raw) < 0.005 && metric === 'revenue' ? '<0.01' : fmt(metric, raw));

export function money(metric: MetricKey, raw: number): string {
  return metric === 'revenue' ? `₹${fmt(metric, raw)} Cr` : `${fmt(metric, raw)} ${METRICS[metric].unit}`;
}
const signed = (metric: MetricKey, raw: number) => `${raw >= 0 ? '+' : '−'}${fmt(metric, Math.abs(raw))}`;
export const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
const growth = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);
const tone = (v: number | null): Cell => (v === null ? { text: '–', tone: 'muted' } : { text: pct(v), tone: v >= 0 ? 'up' : 'down' });
export const monthsWithData = (y: HistoryYear) => y.revenue.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
const sumAt = (xs: number[], idx: number[]) => idx.reduce((a, i) => a + xs[i], 0);
export const yearColor = (selected: number[], fy: number) => YEAR_COLORS[Math.max(0, selected.indexOf(fy)) % YEAR_COLORS.length];

/** Year total, plus the same-months comparison with the year before (for part-years). */
export function yearVsPrevious(years: HistoryYear[], y: HistoryYear, metric: MetricKey) {
  const prev = years.find((p) => p.fy === y.fy - 1);
  const months = monthsWithData(y);
  const total = sumAt(y[metric], months);
  const prevSame = prev ? sumAt(prev[metric], months) : null;
  return { total, prev, prevSame, partial: months.length < 12, months, g: prevSame ? growth(total, prevSame) : null };
}

function axisValue(metric: MetricKey) {
  return { type: 'value', name: METRICS[metric].label, nameLocation: 'middle', nameGap: 52, nameTextStyle: { color: NAVY, fontWeight: 700 }, axisLabel: { color: NAVY }, axisLine: { show: true, lineStyle: { color: '#94a3b8' } }, splitLine: { lineStyle: { color: '#e8edf4' } } };
}
const baseChart = { textStyle: { fontFamily: FONT }, tooltip: { trigger: 'axis' } };

/* ---------------------------------------------------------------- reports */

export function monthlyChart(years: HistoryYear[], selected: number[], metric: MetricKey): EChartsCoreOption {
  const shown = selected.map((fy) => years.find((y) => y.fy === fy)).filter((y): y is HistoryYear => !!y);
  const labels = shown.length <= 3;
  return {
    ...baseChart,
    tooltip: { trigger: 'axis', valueFormatter: (v: number | null) => (v === null || v === undefined ? 'No data' : money(metric, metric === 'revenue' ? v * CRORE : v)) },
    legend: { top: 0, right: 0, icon: 'circle', itemGap: 18, textStyle: { color: NAVY, fontSize: 13, fontWeight: 600 } },
    grid: { left: 64, right: 20, top: 40, bottom: 34 },
    xAxis: { type: 'category', data: MONTHS, boundaryGap: false, axisTick: { show: false }, axisLine: { lineStyle: { color: '#94a3b8' } }, axisLabel: { color: NAVY, fontSize: 13 } },
    yAxis: axisValue(metric),
    series: shown.map((y) => {
      const color = yearColor(selected, y.fy);
      return {
        name: fyShort(y.fy), type: 'line', smooth: 0.2, symbol: 'circle', symbolSize: 8, connectNulls: false,
        data: y[metric].map((v, i) => (y.revenue[i] ? Number(METRICS[metric].scale(v).toFixed(2)) : null)),
        lineStyle: { color, width: 3 }, itemStyle: { color, borderColor: '#fff', borderWidth: 2 },
        label: { show: labels, position: 'top', color, fontWeight: 800, fontSize: 12, formatter: ({ value }: { value: number }) => value.toLocaleString('en-IN', { maximumFractionDigits: METRICS[metric].digits(value) }) },
        labelLayout: { hideOverlap: true },
      };
    }),
  };
}

export function monthlyTable(years: HistoryYear[], selected: number[], metric: MetricKey): ReportTable {
  const rows: Cell[][] = selected.map((fy) => {
    const y = years.find((x) => x.fy === fy);
    if (!y) return [];
    const r = yearVsPrevious(years, y, metric);
    return [{ text: fyShort(fy), tone: 'bold' }, ...y[metric].map((v, i): Cell => (y.revenue[i] ? fmt(metric, v) : { text: '–', tone: 'muted' })),
      { text: fmt(metric, r.total), tone: 'bold' }, tone(r.g)];
  });
  const [a, b] = selected;
  const ya = years.find((y) => y.fy === a);
  const yb = years.find((y) => y.fy === b);
  if (ya && yb) {
    const months = monthsWithData(ya).filter((i) => yb.revenue[i]);
    const diff = sumAt(ya[metric], months) - sumAt(yb[metric], months);
    rows.push([{ text: `${fyShort(a)} vs ${fyShort(b)} (Δ)`, tone: 'bold' },
      ...MONTHS.map((_, i): Cell => (months.includes(i) ? { text: signed(metric, ya[metric][i] - yb[metric][i]), tone: ya[metric][i] >= yb[metric][i] ? 'up' : 'down' } : { text: '–', tone: 'muted' })),
      { text: signed(metric, diff), tone: diff >= 0 ? 'up' : 'down' }, tone(growth(sumAt(ya[metric], months), sumAt(yb[metric], months)))]);
  }
  return { title: `Monthly ${METRICS[metric].short} Details (${METRICS[metric].unit})`, head: ['Year', ...MONTHS, `Total (${METRICS[metric].unit})`, 'Growth vs LY'], rows,
    note: 'Growth vs LY compares the same months of the year before, so a part-year is compared fairly.' };
}

function quarterly(years: HistoryYear[], selected: number[], metric: MetricKey): ReportSpec {
  const shown = selected.map((fy) => years.find((y) => y.fy === fy)).filter((y): y is HistoryYear => !!y);
  const q = (y: HistoryYear, k: number) => y[metric].slice(k * 3, k * 3 + 3).reduce((a, v) => a + v, 0);
  const hasQ = (y: HistoryYear, k: number) => y.revenue.slice(k * 3, k * 3 + 3).some(Boolean);
  const rows: Cell[][] = shown.map((y) => {
    const prev = years.find((p) => p.fy === y.fy - 1);
    const cells: Cell[] = [{ text: fyShort(y.fy), tone: 'bold' }];
    for (let k = 0; k < 4; k++) {
      if (!hasQ(y, k)) { cells.push({ text: '–', tone: 'muted' }, { text: '–', tone: 'muted' }); continue; }
      cells.push(fmt(metric, q(y, k)), tone(prev && hasQ(prev, k) ? growth(q(y, k), q(prev, k)) : null));
    }
    return cells;
  });
  return {
    key: 'quarterly', title: `Quarterly ${METRICS[metric].short} Summary`, subtitle: `${shown.map((y) => fyShort(y.fy)).join(', ')} · ${METRICS[metric].label}`, kpis: [],
    chart: {
      ...baseChart, legend: { top: 0, right: 0, textStyle: { color: NAVY, fontWeight: 600 } }, grid: { left: 64, right: 20, top: 40, bottom: 34 },
      xAxis: { type: 'category', data: QUARTERS, axisTick: { show: false }, axisLabel: { color: NAVY, fontSize: 13 } }, yAxis: axisValue(metric),
      series: shown.map((y) => ({ name: fyShort(y.fy), type: 'bar', barGap: '10%', itemStyle: { color: yearColor(selected, y.fy), borderRadius: [3, 3, 0, 0] },
        data: [0, 1, 2, 3].map((k) => (hasQ(y, k) ? Number(METRICS[metric].scale(q(y, k)).toFixed(2)) : null)),
        label: { show: shown.length <= 3, position: 'top', color: NAVY, fontWeight: 700, fontSize: 11, formatter: ({ value }: { value: number }) => value.toLocaleString('en-IN', { maximumFractionDigits: METRICS[metric].digits(value) }) } })),
    },
    tables: [{ title: `Quarter-wise ${METRICS[metric].short} (${METRICS[metric].unit}) with growth vs the same quarter last year`, head: ['Year', ...QUARTERS.flatMap((x) => [x, 'Growth'])], rows }],
    notes: [],
  };
}

function yoy(years: HistoryYear[], selected: number[], metric: MetricKey): ReportSpec {
  const shown = [...selected].sort((a, b) => a - b).map((fy) => years.find((y) => y.fy === fy)).filter((y): y is HistoryYear => !!y);
  const rows: Cell[][] = shown.map((y) => {
    const r = yearVsPrevious(years, y, metric);
    return [{ text: fyShort(y.fy), tone: 'bold' }, `${r.months.length} of 12${r.partial ? ' (part-year)' : ''}`, { text: fmt(metric, r.total), tone: 'bold' },
      r.prevSame === null ? { text: '–', tone: 'muted' } : fmt(metric, r.prevSame), r.prevSame === null ? { text: '–', tone: 'muted' } : { text: signed(metric, r.total - r.prevSame), tone: r.total >= r.prevSame ? 'up' : 'down' }, tone(r.g)];
  });
  return {
    key: 'yoy', title: `Year on Year ${METRICS[metric].short}`, subtitle: `${shown.map((y) => fyShort(y.fy)).join(', ')} · ${METRICS[metric].label}`, kpis: [],
    chart: {
      ...baseChart, grid: { left: 64, right: 20, top: 30, bottom: 34 },
      xAxis: { type: 'category', data: shown.map((y) => `${fyShort(y.fy)}${monthsWithData(y).length < 12 ? ' (YTD)' : ''}`), axisTick: { show: false }, axisLabel: { color: NAVY, fontSize: 13, fontWeight: 600 } }, yAxis: axisValue(metric),
      series: [{ type: 'bar', barWidth: '50%', data: shown.map((y) => ({ value: Number(METRICS[metric].scale(y[metric].reduce((a, v) => a + v, 0)).toFixed(2)), itemStyle: { color: yearColor(selected, y.fy), borderRadius: [4, 4, 0, 0] } })),
        label: { show: true, position: 'top', color: NAVY, fontWeight: 800, formatter: ({ value }: { value: number }) => value.toLocaleString('en-IN', { maximumFractionDigits: METRICS[metric].digits(value) }) } }],
    },
    tables: [{ title: `Full-year ${METRICS[metric].short} (${METRICS[metric].unit})`, head: ['Year', 'Months with data', 'Total', 'Same months last year', 'Change', 'Growth'], rows }],
    notes: ['A part-year is compared with the same months of the year before.'],
  };
}

function trend(years: HistoryYear[], metric: MetricKey): ReportSpec {
  const totals = years.map((y) => y[metric].reduce((a, v) => a + v, 0));
  const full = years.filter((y) => monthsWithData(y).length === 12);
  const first = full[0], last = full[full.length - 1];
  const cagr = first && last && last.fy > first.fy ? (Math.pow(last[metric].reduce((a, v) => a + v, 0) / first[metric].reduce((a, v) => a + v, 0), 1 / (last.fy - first.fy)) - 1) * 100 : null;
  const rows: Cell[][] = years.map((y, i) => {
    const r = yearVsPrevious(years, y, metric);
    return [{ text: `${fyShort(y.fy)}${r.partial ? ' (YTD)' : ''}`, tone: 'bold' }, { text: fmt(metric, totals[i]), tone: 'bold' },
      r.prevSame === null ? { text: '–', tone: 'muted' } : { text: signed(metric, r.total - r.prevSame), tone: r.total >= r.prevSame ? 'up' : 'down' }, tone(r.g)];
  });
  return {
    key: 'trend', title: `Long-term ${METRICS[metric].short} Trend`, subtitle: `${fyShort(years[0].fy)} – ${fyShort(years[years.length - 1].fy)} · ${METRICS[metric].label}`,
    kpis: [
      { label: 'Years of data', value: String(years.length) },
      ...(cagr !== null ? [{ label: `CAGR (${fyShort(first.fy)}–${fyShort(last.fy)})`, value: pct(cagr), tone: cagr >= 0 ? 'up' as const : 'down' as const }] : []),
      { label: 'Best year', value: fyShort(years[totals.indexOf(Math.max(...totals))].fy), sub: money(metric, Math.max(...totals)) },
    ],
    chart: {
      ...baseChart, grid: { left: 64, right: 20, top: 30, bottom: 34 },
      xAxis: { type: 'category', data: years.map((y) => fyShort(y.fy)), axisTick: { show: false }, axisLabel: { color: NAVY, fontSize: 12, interval: 0 } }, yAxis: axisValue(metric),
      series: [
        { type: 'bar', barWidth: '58%', data: totals.map((t, i) => ({ value: Number(METRICS[metric].scale(t).toFixed(2)), itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: i === totals.length - 1 ? '#7c5cf0' : '#3ea2ff' }, { offset: 1, color: i === totals.length - 1 ? '#5b3fd6' : '#1559d6' }] }, borderRadius: [4, 4, 0, 0] } })),
          label: { show: true, position: 'top', color: NAVY, fontWeight: 700, fontSize: 11, formatter: ({ value }: { value: number }) => value.toLocaleString('en-IN', { maximumFractionDigits: METRICS[metric].digits(value) }) } },
        { type: 'line', smooth: true, symbol: 'none', data: totals.map((t) => Number(METRICS[metric].scale(t).toFixed(2))), lineStyle: { color: '#f97316', width: 2, type: 'dashed' }, tooltip: { show: false } },
      ],
    },
    tables: [{ title: `Year-wise ${METRICS[metric].short} (${METRICS[metric].unit})`, head: ['Year', 'Total', 'Change vs LY', 'Growth vs LY'], rows }],
    notes: [cagr !== null ? `CAGR uses complete years only (${fyShort(first.fy)} to ${fyShort(last.fy)}).` : 'Not enough complete years for a CAGR.', 'YTD years are compared with the same months of the year before.'],
  };
}

function annual(years: HistoryYear[], fy: number, metric: MetricKey): ReportSpec {
  const y = years.find((x) => x.fy === fy)!;
  const r = yearVsPrevious(years, y, metric);
  const prev = r.prev;
  const vals = r.months.map((i) => y[metric][i]);
  const best = r.months[vals.indexOf(Math.max(...vals))];
  const worst = r.months[vals.indexOf(Math.min(...vals))];
  const calYear = (i: number) => fy + (i >= 9 ? 1 : 0);
  const qSum = (yy: HistoryYear, k: number) => yy[metric].slice(k * 3, k * 3 + 3).reduce((a, v) => a + v, 0);
  const totalRev = Object.values(y.products).reduce((a, v) => a + v, 0);
  const prevProducts = prev?.products ?? {};
  const prevRev = Object.values(prevProducts).reduce((a, v) => a + v, 0);
  const zoneTotal = Object.values(y.zones).reduce((a, v) => a + v, 0);
  return {
    key: 'annual', title: `Annual Review – ${fyShort(fy)}`, subtitle: `April ${fy} – March ${fy + 1}${r.partial ? ` · data for ${r.months.length} months so far` : ''} · ${METRICS[metric].label}`,
    kpis: [
      { label: `Total ${METRICS[metric].short}${r.partial ? ' (YTD)' : ''}`, value: money(metric, r.total), sub: r.g !== null ? `${pct(r.g)} vs ${fyShort(fy - 1)}${r.partial ? ' same months' : ''}` : undefined, tone: r.g === null ? undefined : r.g >= 0 ? 'up' : 'down' },
      { label: 'Best month', value: `${MONTHS[best]} ${calYear(best)}`, sub: money(metric, y[metric][best]) },
      { label: 'Weakest month', value: `${MONTHS[worst]} ${calYear(worst)}`, sub: money(metric, y[metric][worst]) },
      { label: 'Monthly average', value: money(metric, r.total / Math.max(1, r.months.length)) },
    ],
    chart: {
      ...baseChart, legend: { top: 0, right: 0, textStyle: { color: NAVY, fontWeight: 600 } }, grid: { left: 64, right: 20, top: 40, bottom: 34 },
      xAxis: { type: 'category', data: MONTHS, axisTick: { show: false }, axisLabel: { color: NAVY, fontSize: 13 } }, yAxis: axisValue(metric),
      series: [
        ...(prev ? [{ name: fyShort(fy - 1), type: 'bar', barGap: '8%', itemStyle: { color: '#c5ccd6', borderRadius: [3, 3, 0, 0] }, data: prev[metric].map((v) => Number(METRICS[metric].scale(v).toFixed(2))) }] : []),
        { name: fyShort(fy), type: 'bar', itemStyle: { color: '#1d6fe0', borderRadius: [3, 3, 0, 0] }, data: y[metric].map((v, i) => (y.revenue[i] ? Number(METRICS[metric].scale(v).toFixed(2)) : null)),
          label: { show: true, position: 'top', color: NAVY, fontWeight: 700, fontSize: 11, formatter: ({ value }: { value: number }) => value.toLocaleString('en-IN', { maximumFractionDigits: METRICS[metric].digits(value) }) } },
      ],
    },
    tables: [
      { title: `Quarters (${METRICS[metric].unit})`, head: ['Quarter', fyShort(fy), fyShort(fy - 1), 'Growth'],
        rows: [0, 1, 2, 3].filter((k) => y.revenue.slice(k * 3, k * 3 + 3).some(Boolean)).map((k) => [{ text: QUARTERS[k], tone: 'bold' }, fmt(metric, qSum(y, k)), prev ? fmt(metric, qSum(prev, k)) : { text: '–', tone: 'muted' }, tone(prev ? growth(qSum(y, k), qSum(prev, k)) : null)]) },
      { title: 'Top products (by revenue)', head: ['Product', 'Revenue (₹ Cr)', 'Share', `Share in ${fyShort(fy - 1)}`],
        rows: Object.entries(y.products).slice(0, 10).map(([name, v]) => [{ text: name, tone: 'bold' }, fmtSmall('revenue', v), `${((v * 100) / totalRev).toFixed(1)}%`, prevRev ? `${(((prevProducts[name] ?? 0) * 100) / prevRev).toFixed(1)}%` : { text: '–', tone: 'muted' }]) },
      { title: 'Sales by region (by revenue)', head: ['Region', 'Revenue (₹ Cr)', 'Share'],
        rows: Object.entries(y.zones).sort((a, b) => b[1] - a[1]).map(([z, v]) => [{ text: z, tone: 'bold' }, fmtSmall('revenue', v), `${((v * 100) / zoneTotal).toFixed(1)}%`]) },
    ],
    notes: ['Regions come from the GST state code in the Region column; "Unassigned" rows have no state code.'],
  };
}

export function buildReport(key: ReportKey, years: HistoryYear[], selected: number[], metric: MetricKey): ReportSpec {
  const sorted = [...selected].sort((a, b) => b - a);
  if (key === 'quarterly') return quarterly(years, sorted, metric);
  if (key === 'yoy') return yoy(years, sorted, metric);
  if (key === 'trend') return trend(years, metric);
  if (key === 'annual') return annual(years, sorted[0], metric);
  return {
    key: 'monthly', title: `Monthly ${METRICS[metric].short} Comparison`, subtitle: `${sorted.map(fyShort).join(', ')} · ${METRICS[metric].label}`, kpis: [],
    chart: monthlyChart(years, sorted, metric), tables: [monthlyTable(years, sorted, metric)], notes: [],
  };
}

/* ---------------------------------------------------------------- exports */

/** Draws a chart off-screen on a canvas and returns it as a PNG data URL. */
export async function chartPng(option: EChartsCoreOption, width = 1200, height = 440): Promise<string> {
  const echarts = await import('echarts');
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;`;
  document.body.appendChild(host);
  const chart = echarts.init(host, undefined, { renderer: 'canvas', width, height });
  try {
    chart.setOption({ ...option, animation: false });
    return chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' });
  } finally {
    chart.dispose();
    host.remove();
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cellText = (c: Cell) => (typeof c === 'string' ? c : c.text);

/* ---------------------------------------------------------------- PDF letterhead */

export const COMPANY = {
  name: 'BEKO Technologies India Pvt Ltd',
  address: '43, Gandhi Nagar Industrial Area Rd, Chenna Reddy Nagar, Venkatarami Reddy Nagar, Balanagar, Hyderabad, Telangana 500054',
};

export const generatedAt = () => new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * Header and footer printed on every PDF page (Chromium print templates). Templates
 * need explicit font sizes; pageNumber/totalPages spans are filled in by the printer.
 */
export function pdfLetterhead(reportName: string, logoDataUrl: string, generated: string): { header: string; footer: string } {
  const base = "font-family:'Segoe UI',Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#0b1b4d;";
  const header = `
    <div style="${base}width:100%;box-sizing:border-box;padding:0 9mm;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:2px solid #1450b8;padding-bottom:6px;">
        <div style="display:flex;align-items:center;gap:9px;min-width:0;">
          ${logoDataUrl ? `<img src="${logoDataUrl}" style="height:38px;width:38px;object-fit:contain;" />` : ''}
          <div style="min-width:0;">
            <div style="font-size:12px;font-weight:700;letter-spacing:.2px;">${esc(COMPANY.name)}</div>
            <div style="font-size:7.5px;color:#475569;line-height:1.3;max-width:430px;">${esc(COMPANY.address)}</div>
          </div>
        </div>
        <div style="text-align:right;white-space:nowrap;">
          <div style="font-size:11px;font-weight:700;color:#1450b8;">${esc(reportName)}</div>
          <div style="font-size:8px;color:#475569;">Generated: ${esc(generated)}</div>
        </div>
      </div>
    </div>`;
  const footer = `
    <div style="${base}width:100%;box-sizing:border-box;padding:0 9mm;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid #cbd5e1;padding-top:5px;font-size:7.5px;color:#475569;">
        <div style="min-width:0;"><b style="color:#0b1b4d;">${esc(COMPANY.name)}</b> · ${esc(COMPANY.address)}</div>
        <div style="white-space:nowrap;">${esc(reportName)} · Generated ${esc(generated)} · Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>
      </div>
    </div>`;
  return { header, footer };
}

export function reportHtml(spec: ReportSpec, chartDataUrl: string, generated = generatedAt()): string {
  const now = generated;
  const cell = (c: Cell) => {
    const t = typeof c === 'string' ? undefined : c.tone;
    const cls = t === 'up' ? 'up' : t === 'down' ? 'down' : t === 'bold' ? 'b' : t === 'muted' ? 'm' : '';
    return `<td class="${cls}">${esc(cellText(c))}</td>`;
  };
  const tables = spec.tables.map((t) => `
    <section class="card"><h3>${esc(t.title)}</h3>
      <table><thead><tr>${t.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${t.rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table>
      ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}</section>`).join('');
  const kpis = spec.kpis.length ? `<div class="kpis">${spec.kpis.map((k) => `<div class="kpi"><div class="kl">${esc(k.label)}</div><div class="kv">${esc(k.value)}</div>${k.sub ? `<div class="ks ${k.tone ?? ''}">${esc(k.sub)}</div>` : ''}</div>`).join('')}</div>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(spec.title)}</title><style>
    @page{size:A4 landscape;margin:24mm 9mm 15mm 9mm} *{box-sizing:border-box} body{margin:0;font-family:'Segoe UI',Arial,sans-serif;color:#0b1b4d;background:#f4f8ff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .band{background:linear-gradient(100deg,#0b2a6b,#1450b8 60%,#1e88e5);color:#fff;padding:18px 26px;border-radius:0 0 18px 18px}
    .eyebrow{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#9fe7dc;font-weight:700}
    h1{margin:4px 0 2px;font-size:26px} .sub{font-size:13px;opacity:.9} .meta{font-size:11px;opacity:.75;margin-top:6px}
    main{padding:16px 22px} .card{background:#fff;border:1px solid #e3ebf7;border-radius:14px;padding:14px 16px;margin-bottom:14px;page-break-inside:avoid}
    h3{margin:0 0 10px;font-size:15px} img{width:100%;display:block}
    table{width:100%;border-collapse:collapse;font-size:11px} th{background:#0b2a6b;color:#fff;padding:7px 6px;text-align:center;font-weight:600}
    td{padding:6px;text-align:center;border-top:1px solid #e8eef7} tr:nth-child(even) td{background:#f4f8fd} tr{page-break-inside:avoid}
    td:first-child,th:first-child{text-align:left;padding-left:10px} .up{color:#0f9b62;font-weight:700} .down{color:#e11d48;font-weight:700} .b{font-weight:700} .m{color:#94a3b8}
    .note{font-size:10px;color:#64748b;margin:8px 0 0} .kpis{display:flex;gap:12px;margin-bottom:14px}
    .kpi{flex:1;background:linear-gradient(135deg,#eaf3ff,#fff);border:1px solid #d8e6fb;border-radius:12px;padding:10px 12px}
    .kl{font-size:11px;color:#475569;font-weight:600} .kv{font-size:20px;font-weight:800;margin-top:2px} .ks{font-size:11px;font-weight:700;color:#475569}
    .ks.up{color:#0f9b62} .ks.down{color:#e11d48} footer{font-size:10px;color:#64748b;padding:0 22px 12px}
  </style></head><body>
    <div class="band"><div class="eyebrow">Financial Visualization Tool · Historical Reports</div><h1>${esc(spec.title)}</h1><div class="sub">${esc(spec.subtitle)}</div><div class="meta">Generated ${esc(now)} from the current published data</div></div>
    <main>${kpis}<section class="card"><img src="${chartDataUrl}" alt=""></section>${tables}</main>
    ${spec.notes.length ? `<footer>${spec.notes.map((n) => `<div>• ${esc(n)}</div>`).join('')}</footer>` : ''}
  </body></html>`;
}

export function reportCsv(spec: ReportSpec): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [q(COMPANY.name), q(COMPANY.address), q(`Report: ${spec.title}`), q(`Generated: ${generatedAt()}`), '', q(spec.title), q(spec.subtitle), ''];
  for (const k of spec.kpis) lines.push([k.label, k.value, k.sub ?? ''].map(q).join(','));
  if (spec.kpis.length) lines.push('');
  for (const t of spec.tables) {
    lines.push(q(t.title), t.head.map(q).join(','), ...t.rows.map((r) => r.map((c) => q(cellText(c))).join(',')), '');
  }
  for (const n of spec.notes) lines.push(q(n));
  return lines.join('\r\n');
}

/** UTF-8 (with BOM so Excel shows ₹ correctly) as base64. */
export function textToBase64(text: string, bom = true): string {
  const bytes = new TextEncoder().encode((bom ? '﻿' : '') + text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
