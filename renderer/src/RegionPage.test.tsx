import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RegionView, SAMPLE_REGIONS } from './pages/RegionPage';

describe('RegionPage', () => {
  it('shows regional sales by quarter, shares, year-on-year and highlights', () => {
    render(<RegionView data={SAMPLE_REGIONS} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Strong global presence drives sales in FY25' })).toBeInTheDocument();
    expect(screen.getByText(/North contributing the highest share at/)).toBeInTheDocument();
    expect(screen.getByText('132')).toBeInTheDocument(); // Q4 total row is present
    expect(screen.getByText('Sales by Region and Quarter (₹ Cr) – FY25')).toBeInTheDocument();
    expect(screen.getByText('Quarter-wise Regional Sales Details (₹ Cr) – FY25')).toBeInTheDocument();
    expect(screen.getByText('Key Highlights (FY25 vs FY24)')).toBeInTheDocument();
    expect(screen.getByText('Total (FY25)')).toBeInTheDocument();
    expect(screen.getAllByText('40.6%').length).toBeGreaterThan(0);
    expect(screen.getByText('Maharashtra')).toBeInTheDocument();
  });
});
