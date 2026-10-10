import { useAuth } from '../auth/AuthContext';

export function DashboardPage() {
  const { user } = useAuth();
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-line bg-white p-8">
        <h2 className="text-xl font-semibold">Welcome, {user?.display_name || user?.username}</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          No approved financial data has been loaded yet. Once data is uploaded and approved (or demo data is loaded by the Super
          Admin), the dashboard will show turnover, margins, cash and forecast charts here.
        </p>
      </section>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {['Turnover (FY)', 'Gross margin', 'EBITDA', 'Cash runway'].map((k) => (
          <div key={k} className="rounded-xl border border-dashed border-line bg-white/60 p-5">
            <div className="text-sm text-muted">{k}</div>
            <div className="mt-2 font-heading text-2xl font-semibold text-muted/50">—</div>
            <div className="mt-1 text-xs text-muted">No data yet</div>
          </div>
        ))}
      </div>
    </div>
  );
}
