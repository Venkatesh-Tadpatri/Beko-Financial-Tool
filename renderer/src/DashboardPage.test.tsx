import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DashboardView, SAMPLE_DASHBOARD } from './pages/DashboardPage';

describe('DashboardPage', () => {
  it('renders the executive dashboard from the data, like the reference design', () => {
    render(<DashboardView data={SAMPLE_DASHBOARD} />);
    expect(screen.getByText('Executive Dashboard')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Strong growth and healthy cash position' })).toBeInTheDocument();
    expect(screen.getAllByText('₹517 Cr').length).toBeGreaterThan(0);
    expect(screen.getByText('₹140 Cr')).toBeInTheDocument();
    expect(screen.getByText('42 days')).toBeInTheDocument();
    expect(screen.getAllByText('25.0%').length).toBeGreaterThan(0); // ROE card (and Product B's share)
    // Product status is an icon only; its accessible name carries the change.
    expect(screen.getAllByRole('img', { name: /^Increased \+/ }).length).toBeGreaterThan(0);    expect(screen.getByText('Sales Trend (₹ Cr)')).toBeInTheDocument();
    expect(screen.getByText('Sales by Product, Share %')).toBeInTheDocument();
    expect(screen.getByText('Operating Profit (₹ Cr)')).toBeInTheDocument();
    expect(screen.getByText('Improved Receivables')).toBeInTheDocument();
  });

  it('asks for the missing uploads instead of inventing finance figures', () => {
    const salesOnly = {
      ...SAMPLE_DASHBOARD,
      years: SAMPLE_DASHBOARD.years.map((y) => ({ ...y, operating_profit_paise: null, free_cash_flow_paise: null, roe_pct: null, dso_days: null })),
    };
    render(<DashboardView data={salesOnly} />);
    expect(screen.getByText(/Upload Cash flow data/)).toBeInTheDocument();
    expect(screen.getByText(/Upload Receivables ageing data/)).toBeInTheDocument();
    expect(screen.getByText(/Upload Profit and loss and Balance sheet data/)).toBeInTheDocument();
    expect(screen.getByText(/Upload Profit and loss data \(revenue/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Strong growth' })).toBeInTheDocument();
    expect(screen.getByText('Top Product')).toBeInTheDocument();
  });
});
