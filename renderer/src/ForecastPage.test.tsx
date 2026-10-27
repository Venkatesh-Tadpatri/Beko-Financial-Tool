import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildRows, ForecastView, SAMPLE_YEAR } from './pages/ForecastPage';

describe('ForecastPage', () => {
  it('compares actual with forecast month by month, like the reference design', () => {
    render(<ForecastView year={SAMPLE_YEAR} period="H1" />);
    expect(screen.getByRole('heading', { level: 1, name: 'H1 FY25 beat forecast by 7.5%' })).toBeInTheDocument();
    expect(screen.getByText('₹258 Cr', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText(/^\+₹18 Cr\s+\(\+7\.5%\)$/)).toBeInTheDocument();
    expect(screen.getByText('5 / 6')).toBeInTheDocument();
    expect(screen.getByText('1 / 6')).toBeInTheDocument();
    expect(screen.getByText('Total (H1)')).toBeInTheDocument();
    expect(screen.getAllByText('Below').length).toBe(1);
  });

  it('only compares months that have both an actual and a forecast, and explains a missing forecast', () => {
    expect(buildRows(SAMPLE_YEAR, 'FY').filter((r) => r.variance !== null)).toHaveLength(6);
    render(<ForecastView year={{ ...SAMPLE_YEAR, forecast: null }} period="H1" />);
    expect(screen.getByText(/No revenue forecast has been uploaded for FY25 yet/)).toBeInTheDocument();
  });
});
