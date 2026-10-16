import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TurnoverPage } from './pages/TurnoverPage';

describe('TurnoverPage', () => {
  it('renders the header, chart card, stat cards, tables and takeaways without error', () => {
    render(<TurnoverPage />);
    expect(screen.getByRole('heading', { name: 'Turnover grew 4.8× in 20 years' })).toBeInTheDocument();
    expect(screen.getByText('Annual Turnover Trend (FY06 – FY25)')).toBeInTheDocument();
    expect(screen.getByText('20-year growth')).toBeInTheDocument();
    expect(screen.getByText('Key Takeaways')).toBeInTheDocument();
    // FY06 appears in both detail tables; FY25 turnover 480 is in the second table.
    expect(screen.getAllByText('FY06').length).toBeGreaterThan(0);
    expect(screen.getByText('480')).toBeInTheDocument();
  });
});
