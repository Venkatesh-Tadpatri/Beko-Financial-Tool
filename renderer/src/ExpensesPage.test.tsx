import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ExpensesView, SAMPLE_EXPENSES } from './pages/ExpensesPage';

describe('ExpensesPage', () => {
  it('shows quarterly, half-yearly and yearly expenses against the previous year', () => {
    render(<ExpensesView years={SAMPLE_EXPENSES} fy={2024} />);
    expect(screen.getByRole('heading', { level: 1, name: 'FY25 expenses increased by 12.9% vs FY24' })).toBeInTheDocument();
    expect(screen.getByText('₹410 Cr')).toBeInTheDocument();
    expect(screen.getByText('₹463 Cr')).toBeInTheDocument();
    expect(screen.getByText(/Q1 and Q3 saw a reduction, while Q2 and Q4 were higher/)).toBeInTheDocument();
    for (const t of ['Quarterly Expenses (₹ Cr)', 'Half-Yearly Expenses (₹ Cr)', 'Yearly Expenses Trend (₹ Cr)', 'Yearly Expense Details (₹ Cr)']) {
      expect(screen.getByText(t)).toBeInTheDocument();
    }
    expect(screen.getAllByText('+39.1%').length).toBeGreaterThan(0);
  });

  it('compares a part-year with the same months of the year before', () => {
    const partial = [SAMPLE_EXPENSES[3], { ...SAMPLE_EXPENSES[4], months: SAMPLE_EXPENSES[4].months.map((v, i) => (i < 3 ? v : 0)) }];
    render(<ExpensesView years={partial} fy={2024} />);
    // Q1 only: 90 vs 95
    expect(screen.getByRole('heading', { level: 1, name: 'FY25 expenses decreased by 5.3% vs FY24' })).toBeInTheDocument();
  });
});
