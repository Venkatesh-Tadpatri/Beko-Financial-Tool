import { authApi } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { Button } from '../components/ui';
import { AuthLayout } from './AuthLayout';

/** Shown after sign-in when the password must be changed (first sign-in, or after a reset). */
export function ChangePasswordScreen() {
  const { user, passwordChanged, logout } = useAuth();
  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={`Welcome, ${user?.display_name || user?.username}. You are using a starting password. Choose your own password to continue.`}
    >
      <ChangePasswordForm
        fixedUsername={user?.username ?? ''}
        onSubmit={async (c) => {
          await authApi.changePassword(c.current, c.next, c.confirm);
          await passwordChanged();
        }}
        extraButtons={
          <Button type="button" variant="secondary" onClick={() => void logout()}>
            Sign out
          </Button>
        }
      />
    </AuthLayout>
  );
}
