import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RevenuePage } from './pages/RevenuePage';

describe('RevenuePage', () => {
  it('renders the revenue dashboard sections', () => {
    render(<RevenuePage />);
    expect(screen.getByRole('heading', { name: /FY25 revenue up/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /6\.1%/ })).toBeInTheDocument();
    expect(screen.getByText('Quarterly Revenue Comparison (₹ Crore)')).toBeInTheDocument();
    expect(screen.getByText('FY25 Total Revenue')).toBeInTheDocument();
    expect(screen.getByText(/Quarterly Revenue Details/)).toBeInTheDocument();
    expect(screen.getByText(/Key Takeaways/)).toBeInTheDocument();
  });
});
