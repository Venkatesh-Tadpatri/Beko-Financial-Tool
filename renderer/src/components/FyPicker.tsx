/** Short label for a financial year starting in April of `fy`, e.g. 2024 -> "FY25". */
export function fyShort(fy: number) { return `FY${String(fy + 1).slice(-2)}`; }

/** Financial-year card that doubles as a dropdown of the years that have data. */
export function FyPicker({ fy, years, onChange }: { fy: number | null; years: number[]; onChange: (fy: number) => void }) {
  const options = [...years].sort((a, b) => b - a);
  const range = fy === null ? '' : `Apr ${fy} – Mar ${fy + 1}`;
  return <label className="relative flex min-w-[224px] cursor-pointer items-center gap-3 rounded-2xl bg-gradient-to-br from-sky-50 to-blue-50 px-5 py-3 shadow-sm hover:ring-2 hover:ring-blue-200 focus-within:ring-2 focus-within:ring-blue-400">
    <CalendarIcon />
    <div className="whitespace-nowrap text-navy-900">
      <div className="text-xs font-semibold">Financial Year</div>
      <div className="flex items-center gap-1.5 font-heading text-2xl font-extrabold leading-tight">{fy === null ? 'FY' : fyShort(fy)}{options.length > 1 && <svg className="h-4 w-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}</div>
      <div className="text-xs font-semibold">({range})</div>
    </div>
    <select aria-label="Financial year" className="absolute inset-0 cursor-pointer opacity-0" value={fy ?? ''} disabled={options.length < 2} onChange={(e) => onChange(Number(e.target.value))}>
      {options.map((y) => <option key={y} value={y}>{fyShort(y)} (Apr {y} – Mar {y + 1})</option>)}
    </select>
  </label>;
}

function CalendarIcon() { return <svg className="h-11 w-11 text-blue-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18" /><path d="M7 14h2m3 0h2m3 0h1M7 17h2m3 0h2m3 0h1" /></svg>; }
