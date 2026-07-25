import { KeycloakProvider } from './auth/KeycloakProvider';
import { AppShell } from './components/shell/AppShell';

export default function App() {
  return (
    <KeycloakProvider>
      <AppShell />
    </KeycloakProvider>
  );
}
