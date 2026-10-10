import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Logo, Spinner } from '../components/ui';
import { AuthLayout } from './AuthLayout';

export function StartingScreen() {
  return (
    <div className="grid h-full place-items-center">
      <div className="flex flex-col items-center gap-6 text-brand-600">
        <Logo />
        <Spinner />
        <p className="text-sm text-muted">Starting and checking your data…</p>
      </div>
    </div>
  );
}

export function UnavailableScreen() {
  const { error, refresh } = useAuth();
  return (
    <AuthLayout title="The data service is not available" subtitle="The application could not reach its local data service.">
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-sm text-muted">Your data has not been changed. Try again, or restart the application.</p>
        <Button onClick={() => void refresh()}>Try again</Button>
      </div>
    </AuthLayout>
  );
}

const RECOVERY_TITLES: Record<string, string> = {
  integrity_failed: 'The database needs to be restored',
  migration_failed: 'The update could not be applied',
  newer_database: 'This data needs a newer version',
};

export function RecoveryScreen() {
  const { status } = useAuth();
  const code = status?.recovery?.code ?? 'integrity_failed';
  return (
    <AuthLayout title={RECOVERY_TITLES[code] ?? 'The application needs attention'}>
      <div className="space-y-4">
        <Alert kind="warning">{status?.recovery?.message}</Alert>
        <p className="text-sm leading-relaxed text-muted">
          Nothing has been overwritten. No data, menus or reports are available until this is resolved.
        </p>
        <p className="text-sm leading-relaxed text-muted">
          A Super Admin can restore the latest good backup from this screen. You will be asked for a Super Admin password from that
          backup. (The restore button is added together with the backup screen.)
        </p>
      </div>
    </AuthLayout>
  );
}
