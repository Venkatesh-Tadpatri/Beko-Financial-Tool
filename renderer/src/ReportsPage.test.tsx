import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { HistoryYear } from './api/data';
import { ReportsView } from './pages/ReportsPage';
import { buildReport, COMPANY, pdfLetterhead, reportCsv, reportHtml } from './reports/reportBuilder';

const CR = 1_000_000_000;
const year = (fy: number, monthly: number[], partial = 12): HistoryYear => ({
  fy, label: `FY${fy}`,
  revenue: monthly.map((v, i) => (i < partial ? v * CR : 0)),
  units: monthly.map((_, i) => (i < partial ? 10 : 0)),
  invoices: monthly.map((_, i) => (i < partial ? 2 : 0)),
  products: { 'Product A': 60 * CR, 'Product B': 40 * CR },
  zones: { West: 70 * CR, South: 30 * CR },
});
const YEARS = [year(2022, Array(12).fill(26)), year(2023, Array(12).fill(32)), year(2024, Array(12).fill(40))];

describe('ReportsPage', () => {
  it('compares the selected years month by month with a report library', () => {
    render(<ReportsView years={YEARS} />);
    expect(screen.getByRole('heading', { level: 1, name: 'FY25 ahead of FY24 in every month' })).toBeInTheDocument();
    expect(screen.getByText('Monthly Revenue Comparison (₹ Cr)')).toBeInTheDocument();
    expect(screen.getByText('Report Library')).toBeInTheDocument();
    for (const name of ['PDF', 'PNG', 'Excel']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
    expect(screen.getByText('FY25 vs FY24 (Δ)')).toBeInTheDocument();
    expect(screen.getAllByText('+25.0%').length).toBeGreaterThan(0); // 480 vs 384
  });

  it('builds every report, with a part-year compared on the same months', () => {
    const years = [...YEARS, year(2025, Array(12).fill(30), 9)];
    for (const key of ['monthly', 'quarterly', 'yoy', 'trend', 'annual'] as const) {
      const spec = buildReport(key, years, [2025, 2024], 'revenue');
      expect(spec.tables.length).toBeGreaterThan(0);
      expect(reportHtml(spec, 'data:image/png;base64,AA==')).toContain(spec.title);
      expect(reportCsv(spec)).toContain(spec.tables[0].title);
    }
    const yoy = buildReport('yoy', years, [2025, 2024], 'revenue');
    // 9 months of 30 against the same 9 months of 40 last year = -25%
    expect(reportCsv(yoy)).toContain('−25.0%');
  });

  it('puts the BEKO letterhead, report name, date and page numbers on every PDF page', () => {
    const { header, footer } = pdfLetterhead('Annual Review – FY26', 'data:image/png;base64,AA==', '22 Oct 2026, 3:07 pm');
    for (const part of [header, footer]) {
      expect(part).toContain(COMPANY.name);
      expect(part).toContain('Annual Review – FY26');
      expect(part).toContain('22 Oct 2026, 3:07 pm');
    }
    expect(header).toContain('Balanagar, Hyderabad, Telangana 500054');
    expect(header).toContain('<img src="data:image/png;base64,AA=="');
    expect(footer).toContain('<span class="pageNumber"></span> of <span class="totalPages"></span>');
  });
});
