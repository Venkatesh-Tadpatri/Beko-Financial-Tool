import { HashRouter } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import { ChangePasswordScreen } from './screens/ChangePasswordScreen';
import { LoginScreen } from './screens/LoginScreen';
import { SetupScreen } from './screens/SetupScreen';
import { RecoveryScreen, StartingScreen, UnavailableScreen } from './screens/StatusScreens';
import { AppShell } from './shell/AppShell';

/** The phase decides which screen exists at all; the app shell is never mounted before sign-in. */
export function App() {
  const { phase } = useAuth();
  switch (phase) {
    case 'starting':
      return <StartingScreen />;
    case 'unavailable':
      return <UnavailableScreen />;
    case 'recovery':
      return <RecoveryScreen />;
    case 'setup':
      return <SetupScreen />;
    case 'login':
      return <LoginScreen />;
    case 'change-password':
      return <ChangePasswordScreen />;
    case 'app':
      return (
        <HashRouter>
          <AppShell />
        </HashRouter>
      );
  }
}
