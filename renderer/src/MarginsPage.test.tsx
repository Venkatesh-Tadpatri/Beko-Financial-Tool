import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarginsView, SAMPLE_MARGINS } from './pages/MarginsPage';

describe('MarginsPage', () => {
  it('computes margins from Profit and loss data like the reference design', () => {
    render(<MarginsView years={SAMPLE_MARGINS} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Profit margin improved from 9.1% in FY20 to 15.1% in FY25' })).toBeInTheDocument();
    expect(screen.getAllByText('₹732 Cr').length).toBeGreaterThan(0); // EBITDA card (and chart)
    expect(screen.getByText('₹461 Cr')).toBeInTheDocument(); // PAT
    expect(screen.getAllByText('20.7%').length).toBeGreaterThan(0); // PAT CAGR
  });

  it('shows sales revenue and leaves profit figures empty until P&L is uploaded', () => {
    const salesOnly = SAMPLE_MARGINS.map((y) => ({ ...y, pnl: null }));
    render(<MarginsView years={salesOnly} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Profitability trend awaiting P&L data' })).toBeInTheDocument();
    expect(screen.getByText('₹3,050 Cr')).toBeInTheDocument();
    expect(screen.getAllByText('Needs P&L upload')).toHaveLength(3);
    expect(screen.getByText(/Gross and operating margins need Profit & Loss data/)).toBeInTheDocument();
  });
});
