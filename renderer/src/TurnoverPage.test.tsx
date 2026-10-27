import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildRows, SAMPLE_POINTS, TurnoverView } from './pages/TurnoverPage';

describe('TurnoverPage', () => {
  it('renders the annual trend, year-wise tables and computed takeaways', () => {
    render(<TurnoverView rows={buildRows(SAMPLE_POINTS)} annual fyLabel="FY25" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Turnover grew 4.8× in 20 years' })).toBeInTheDocument();
    expect(screen.getByText(/Each bar represents one financial year/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Annual Turnover Trend (FY06 – FY25)' })).toBeInTheDocument();
    expect(screen.getByText('Year-wise Turnover and Growth Details')).toBeInTheDocument();
    expect(screen.getByText('Key Takeaways')).toBeInTheDocument();
    // stat cards
    expect(screen.getByText('20-year growth')).toBeInTheDocument();
    expect(screen.getByText('+380%')).toBeInTheDocument();
    expect(screen.getAllByText('8.6%').length).toBe(2); // CAGR card and takeaway
    expect(screen.getByText('Lowest year (FY20)')).toBeInTheDocument();
    expect(screen.getByText('FY21 +16.7%')).toBeInTheDocument();
    expect(screen.getByText('480')).toBeInTheDocument();
    expect(screen.getByText(/4\.8× \(380%\)/)).toBeInTheDocument();
    expect(screen.getByText(/One year of decline observed in FY20/)).toBeInTheDocument();
    expect(screen.getByText(/16\.7% in FY21/)).toBeInTheDocument();
  });
});

describe('Turnover milestones', () => {
  it('marks the first year each multiple of the base year was reached', async () => {
    const { milestones } = await import('./pages/TurnoverPage');
    const marks = milestones(buildRows(SAMPLE_POINTS));
    expect(marks.map((m) => [m.kind, m.mult, SAMPLE_POINTS[m.idx].label])).toEqual([
      ['base', 1, 'FY06'], ['step', 2, 'FY14'], ['step', 3, 'FY19'], ['step', 4, 'FY23'], ['final', 4.8, 'FY25'],
    ]);
  });
});
