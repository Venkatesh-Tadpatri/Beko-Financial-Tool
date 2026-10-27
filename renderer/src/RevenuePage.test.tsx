import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildModel, RevenueView, SAMPLE_MODEL } from './pages/RevenuePage';

describe('RevenuePage', () => {
  it('compares each quarter with the same quarter of the previous year', () => {
    render(<RevenueView model={SAMPLE_MODEL} />);
    expect(screen.getByRole('heading', { level: 1, name: 'FY25 revenue up 6.1% on FY24' })).toBeInTheDocument();
    expect(screen.getByText('Quarterly Revenue Comparison (₹ Crore)')).toBeInTheDocument();
    expect(screen.getByText('FY24 Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('FY25 Total Revenue')).toBeInTheDocument();
    expect(screen.getByText('Q4 +26.9%')).toBeInTheDocument();
    expect(screen.getByText('Q1 −8.3%')).toBeInTheDocument();
    expect(screen.getByText('Total (Q1–Q4)')).toBeInTheDocument();
    expect(screen.getByText(/H1 FY25 \(Apr – Sep\) totals/)).toBeInTheDocument();
    expect(screen.getByText(/Key Takeaways/)).toBeInTheDocument();
  });

  it('compares only the quarters the selected year has, and handles a missing previous year', () => {
    const crore = 1_000_000_000;
    const partial = buildModel(2024, [0, 0, 0, 6 * crore], [5 * crore, 5 * crore, 5 * crore, 5 * crore]);
    const { unmount } = render(<RevenueView model={partial} />);
    expect(screen.getByRole('heading', { level: 1, name: 'FY25 revenue up 20.0% on FY24' })).toBeInTheDocument();
    expect(screen.getByText('Total (uploaded)')).toBeInTheDocument();
    unmount();

    render(<RevenueView model={buildModel(2024, [0, 0, 0, 6 * crore], undefined)} />);
    expect(screen.getByText(/no FY24 data uploaded yet/)).toBeInTheDocument();
  });
});
