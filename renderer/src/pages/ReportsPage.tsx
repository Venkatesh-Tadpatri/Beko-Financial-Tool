import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, peekReportCache } from '../api/client';
import { reportApi, type HistoryYear } from '../api/data';
import { Chart } from '../components/Chart';
import { fyShort } from '../components/FyPicker';
import bekoLogo from '../assets/beko-logo.png';
import {
  buildReport, chartPng, generatedAt, pdfLetterhead, fmt, METRICS, monthlyChart, monthlyTable, MONTHS, monthsWithData, pct, REPORTS, reportCsv, reportHtml,
  textToBase64, yearColor, yearVsPrevious, type Cell, type MetricKey, type ReportKey,
} from '../reports/reportBuilder';

const STALE = '__stale_backend__';

export function ReportsPage() {
  const [years, setYears] = useState<HistoryYear[] | null>(() => peekReportCache<{ years: HistoryYear[] }>('/api/reports/history')?.years ?? null);
  const [error, setError] = useState('');
  useEffect(() => {
    void reportApi.history().then((r) => setYears(r.years)).catch((e: Error) => setError(e instanceof ApiError && e.status === 404 ? STALE : e.message));
  }, []);
  if (error) return <Notice tone="error">{error === STALE ? 'Historical Reports: the data service is out of date. Close the app completely and start it again.' : error}</Notice>;
  if (!years) return null;
  if (!years.length) return <Notice>Historical Reports: no sales data is available yet. Upload and import a Sales Register file.</Notice>;
  return <ReportsView years={years} />;
}

function Notice({ children, tone }: { children: ReactNode; tone?: 'error' }) {
  return <div className={`rounded-2xl border bg-white p-8 text-center ${tone === 'error' ? 'border-rose-200 text-rose-600' : 'border-sky-200 text-muted'}`}>{children}</div>;
}

export function ReportsView({ years }: { years: HistoryYear[] }) {
  const allFys = useMemo(() => years.map((y) => y.fy).sort((a, b) => b - a), [years]);
  const [selected, setSelected] = useState<number[]>(() => allFys.slice(0, 3));
  const [metric, setMetric] = useState<MetricKey>('revenue');
  const [report, setReport] = useState<ReportKey>('monthly');
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ path: string } | { error: string } | null>(null);
  const sorted = [...selected].sort((a, b) => b - a);

  const chart = useMemo(() => monthlyChart(years, sorted, metric), [years, sorted.join(','), metric]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = useMemo(() => monthlyTable(years, sorted, metric), [years, sorted.join(','), metric]); // eslint-disable-line react-hooks/exhaustive-deps

  // Headline: the latest selected year against the next selected year, month by month.
  const [a, b] = sorted;
  const ya = years.find((y) => y.fy === a);
  const yb = years.find((y) => y.fy === b);
  const shared = ya && yb ? monthsWithData(ya).filter((i) => yb.revenue[i]) : [];
  const ahead = ya && yb ? shared.filter((i) => ya[metric][i] >= yb[metric][i]).length : 0;
  const headline = !ya ? 'Select a year to compare'
    : !yb ? `${fyShort(a)} month by month`
    : ahead === shared.length ? <>{fyShort(a)} ahead of {fyShort(b)} in <span className="text-[#1d6fe0]">every month</span></>
    : ahead === 0 ? <>{fyShort(a)} behind {fyShort(b)} in <span className="text-rose-600">every month</span></>
    : ahead * 2 >= shared.length ? <>{fyShort(a)} ahead of {fyShort(b)} in <span className="text-[#1d6fe0]">{ahead} of {shared.length} months</span></>
    : <>{fyShort(a)} behind {fyShort(b)} in <span className="text-rose-600">{shared.length - ahead} of {shared.length} months</span></>;
  const primary = ya ? yearVsPrevious(years, ya, metric) : null;

  async function exportAs(kind: 'pdf' | 'png' | 'csv') {
    if (!sorted.length) return;
    setBusy(kind);
    setSaved(null);
    try {
      const spec = buildReport(report, years, sorted, metric);
      const name = `${spec.title} - ${spec.key === 'trend' ? 'all years' : sorted.map(fyShort).join(' ')}`;
      let path: string | null;
      if (kind === 'csv') {
        path = await window.fvt.saveFile(name, 'csv', textToBase64(reportCsv(spec)));
      } else {
        const png = await chartPng(spec.chart);
        path = kind === 'png'
          ? await window.fvt.saveFile(name, 'png', png.slice(png.indexOf(',') + 1))
          : await exportPdf(spec, png, name);
      }
      if (path) setSaved({ path });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaved({ error: /No handler registered|is not a function/i.test(msg) ? 'Exporting needs the updated app. Close the app completely and start it again.' : `The report could not be saved: ${msg}` });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="relative min-w-0 space-y-3">
      <Backdrop />
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#0e9a6e]">Historical Reports <span className="mx-1 text-[#94a3b8]">|</span> Year on Year</div>
          <h1 className="mt-1 font-heading text-4xl font-extrabold tracking-tight text-[#0b1b4d]">{headline}</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <SelectCard label="Select Years">
            <YearPicker all={allFys} selected={sorted} onChange={setSelected} />
          </SelectCard>
          <SelectCard label="Select Metric">
            <select aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}
              className="h-9 w-56 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-[#0b1b4d] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
              {(Object.keys(METRICS) as MetricKey[]).map((k) => <option key={k} value={k}>{METRICS[k].label}</option>)}
            </select>
          </SelectCard>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <Panel title={`Monthly ${METRICS[metric].short} Comparison (${METRICS[metric].unit})`} icon={<BarsIcon />}>
          {sorted.length ? <div className="h-[360px]"><Chart option={chart} className="h-full w-full" /></div>
            : <p className="grid h-[360px] place-items-center text-sm text-[#475569]">Select at least one year.</p>}
        </Panel>
        <Panel title="Report Library" icon={<DocIcon />}>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm text-[#0b1b4d]">
              <thead><tr className="bg-[#eef3fb] text-left text-[13px] font-semibold"><th className="px-3 py-2">Report</th><th className="px-3 py-2">Description</th><th className="px-3 py-2">Output</th></tr></thead>
              <tbody>
                {REPORTS.map((r) => {
                  const on = report === r.key;
                  return (
                    <tr key={r.key} onClick={() => setReport(r.key)} aria-selected={on}
                      className={`cursor-pointer border-t border-slate-200 transition-colors ${on ? 'bg-[#e8f1ff]' : 'hover:bg-slate-50'}`}>
                      <td className="px-3 py-2">
                        <label className="flex cursor-pointer items-center gap-2 font-semibold">
                          <input type="radio" name="report" checked={on} onChange={() => setReport(r.key)} className="accent-[#1d6fe0]" />{r.name(metric)}
                        </label>
                      </td>
                      <td className="px-3 py-2 text-[#475569]">{r.key === 'annual' && a ? `Detailed performance report for ${fyShort(a)}` : r.description}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-[#475569]">PDF, PNG, Excel</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <ExportButton label="PDF" color="bg-[#0b1f4d] hover:bg-[#13306f]" icon={<DocIcon size={18} />} busy={busy === 'pdf'} disabled={!!busy || !sorted.length} onClick={() => void exportAs('pdf')} />
            <ExportButton label="PNG" color="bg-[#11a37f] hover:bg-[#0e8d6d]" icon={<ImageIcon />} busy={busy === 'png'} disabled={!!busy || !sorted.length} onClick={() => void exportAs('png')} />
            <ExportButton label="Excel" color="bg-[#e9a514] hover:bg-[#d39410]" icon={<SheetIcon />} busy={busy === 'csv'} disabled={!!busy || !sorted.length} onClick={() => void exportAs('csv')} />
          </div>
          <p className="mt-2 text-xs text-[#64748b]">Downloads the selected report for {report === 'trend' ? 'all years' : sorted.map(fyShort).join(', ') || '—'}. Excel downloads a CSV file that opens in Excel.</p>
          {saved && ('path' in saved
            ? <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Saved to <b className="break-all">{saved.path}</b>. <button className="font-semibold underline" onClick={() => void window.fvt.showInFolder(saved.path)}>Show in folder</button></p>
            : <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{saved.error}</p>)}
        </Panel>
      </div>

      <Panel title={table.title} icon={<GridIcon />}
        aside={primary && ya ? (
          <div className="flex flex-wrap gap-2 text-sm font-bold">
            <span className="rounded-lg bg-emerald-50 px-3 py-1 text-emerald-800">{fyShort(a)} total{primary.partial ? ' (YTD)' : ''}: {metric === 'revenue' ? '₹' : ''}{fmt(metric, primary.total)}{metric === 'revenue' ? ' Cr' : ''}</span>
            {primary.g !== null && <span className={`rounded-lg px-3 py-1 ${primary.g >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{primary.g >= 0 ? '▲' : '▼'} {pct(primary.g)} vs {fyShort(a - 1)}{primary.partial ? ' same months' : ''}</span>}
          </div>
        ) : undefined}>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[980px] text-center text-sm text-[#0b1b4d]">
            <thead>
              <tr className="bg-[#0b2a6b] text-[13px] font-semibold text-white">
                {table.head.map((h, i) => <th key={h} className={`px-2 py-2 ${i === 0 ? 'text-left' : ''}`}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, ri) => {
                const fy = sorted[ri];
                const tint = fy !== undefined ? `${yearColor(sorted, fy)}14` : '#ffffff';
                return (
                  <tr key={ri} className="border-t border-slate-200" style={{ background: tint }}>
                    {row.map((c, ci) => <td key={ci} className={`px-2 py-2 tabular-nums ${ci === 0 ? 'text-left' : ''} ${cellClass(c)}`}>
                      {ci === 0 && fy !== undefined && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: yearColor(sorted, fy) }} />}
                      {typeof c === 'string' ? c : c.text}
                    </td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {table.note && <p className="mt-2 text-xs text-[#64748b]">{table.note}</p>}
      </Panel>
    </div>
  );
}

/** PDF with the BEKO letterhead (logo, company, address, report name, date) on every page. */
async function exportPdf(spec: ReturnType<typeof buildReport>, png: string, name: string) {
  const generated = generatedAt();
  const { header, footer } = pdfLetterhead(spec.title, await toDataUrl(bekoLogo), generated);
  return window.fvt.exportPdf(reportHtml(spec, png, generated), name, header, footer);
}

async function toDataUrl(url: string): Promise<string> {
  try {
    const blob = await (await fetch(url)).blob();
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  } catch {
    return ''; // the report still prints, just without the logo
  }
}

function cellClass(c: Cell) {
  if (typeof c === 'string') return '';
  return c.tone === 'up' ? 'font-bold text-emerald-600' : c.tone === 'down' ? 'font-bold text-rose-600' : c.tone === 'bold' ? 'font-bold' : c.tone === 'muted' ? 'text-slate-400' : '';
}

/* ---------------------------------------------------------------- pieces */

function SelectCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/80 bg-white/90 px-4 py-3 shadow-[0_4px_20px_rgba(15,40,90,0.06)]">
      <div className="mb-2 text-sm font-bold text-[#0b1b4d]">{label}</div>
      {children}
    </div>
  );
}

function YearPicker({ all, selected, onChange }: { all: number[]; selected: number[]; onChange: (fys: number[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = (fy: number) => onChange(selected.includes(fy) ? selected.filter((x) => x !== fy) : [...selected, fy]);
  return (
    <div ref={ref} className="relative flex max-w-[360px] flex-wrap items-center gap-1.5">
      {selected.map((fy) => (
        <span key={fy} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-white shadow-sm" style={{ background: yearColor(selected, fy) }}>
          {fyShort(fy)}
          <button type="button" aria-label={`Remove ${fyShort(fy)}`} onClick={() => toggle(fy)} className="ml-0.5 leading-none opacity-80 hover:opacity-100">✕</button>
        </span>
      ))}
      <button type="button" aria-label="Choose years" aria-expanded={open} onClick={() => setOpen(!open)}
        className="grid h-7 w-7 place-items-center rounded-lg text-[#0b1b4d] hover:bg-slate-100">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 max-h-72 w-52 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          {all.map((fy) => (
            <label key={fy} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-[#0b1b4d] hover:bg-slate-50">
              <input type="checkbox" checked={selected.includes(fy)} onChange={() => toggle(fy)} className="accent-[#1d6fe0]" />
              <b>{fyShort(fy)}</b><span className="text-xs text-[#64748b]">Apr {fy} – Mar {fy + 1}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function Panel({ title, icon, aside, children }: { title: string; icon: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_4px_20px_rgba(15,40,90,0.06)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 font-heading text-xl font-bold text-[#0b1b4d]"><span className="text-[#1d6fe0]">{icon}</span>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function ExportButton({ label, color, icon, busy, disabled, onClick }: { label: string; color: string; icon: ReactNode; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex h-12 items-center justify-center gap-2 rounded-xl text-base font-bold text-white shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${color}`}>
      {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : icon}{label}
    </button>
  );
}

/** Soft glow, waves and rising bars behind the page. */
function Backdrop() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] w-full" viewBox="0 0 1600 360" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
      <defs>
        <radialGradient id="rep-glow" cx="70%" cy="0%" r="50%"><stop offset="0" stopColor="#c7dcff" stopOpacity=".9" /><stop offset="1" stopColor="#c7dcff" stopOpacity="0" /></radialGradient>
        <linearGradient id="rep-wave" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#dbe8ff" stopOpacity="0" /><stop offset="1" stopColor="#b9d3ff" stopOpacity=".6" /></linearGradient>
      </defs>
      <rect width="1600" height="360" fill="url(#rep-glow)" />
      <path d="M0 200 C 320 140, 600 250, 950 180 S 1420 90, 1600 130 L1600 0 L0 0 Z" fill="url(#rep-wave)" opacity=".5" />
      <path d="M0 240 C 380 190, 660 280, 1020 215 S 1460 140, 1600 175" fill="none" stroke="#bcd4ff" strokeWidth="2" opacity=".55" />
    </svg>
  );
}

function BarsIcon({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M5 20v-6M10 20V10M15 20V7M20 20V4" /></svg>; }
function DocIcon({ size = 24 }: { size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7V3Z" /><path d="M14 3v4h4M10 12h5M10 15h5M10 18h3" /></svg>; }
function GridIcon() { return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 9v11M15 9v11" /></svg>; }
function ImageIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 17-5-5-9 8" /></svg>; }
function SheetIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v14H6V3Z" /><path d="m9 11 5 6m0-6-5 6" /></svg>; }
