import { useKeycloak } from '../../auth/KeycloakProvider';
import keycloak from '../../auth/keycloak';
import './AppShell.scss';

function displayName(profile: Record<string, unknown> | undefined): string {
  if (!profile) return '';
  if (typeof profile.given_name === 'string') return profile.given_name;
  if (typeof profile.preferred_username === 'string' && !profile.preferred_username.includes('@')) return profile.preferred_username;
  if (typeof profile.email === 'string') return profile.email.split('@')[0];
  return 'Account';
}

// Minimal account indicator for the top bar: a login button when signed
// out, the user's name + a sign-out button when signed in, and nothing at
// all when auth is disabled (VITE_AUTH_DISABLED=true — no Keycloak session
// exists to show). Deliberately not a full AccountMenu like Studio's — this
// app has no menu items to put in a dropdown yet.
function AccountIndicator() {
  const { authenticated, authDisabled } = useKeycloak();

  if (authDisabled) return null;

  if (!authenticated) {
    return (
      <button type="button" className="AppShell__login" onClick={() => keycloak.login()}>
        Log in
      </button>
    );
  }

  const name = displayName(keycloak.idTokenParsed) || 'Account';

  return (
    <div className="AppShell__account">
      <span className="AppShell__account-name">{name}</span>
      <button
        type="button"
        className="AppShell__account-logout"
        onClick={() => keycloak.logout({ redirectUri: window.location.origin })}
      >
        Log out
      </button>
    </div>
  );
}

// The kanecta.io shell: no fixed view set, no router, no view registry —
// just a title bar with auth state and an empty content region that any
// Kanecta component can be mounted into. Contrast with Studio's AppShell
// (src/components/shell/AppShell.tsx in kanecta-app-studio), which is a
// fully opinionated four-sided chrome with a fixed set of views. This one
// stays deliberately bare until kanecta.io needs more.
export function AppShell() {
  return (
    <div className="AppShell">
      <header className="AppShell__header">
        <h1 className="AppShell__title">Kanecta</h1>
        <AccountIndicator />
      </header>
      <main className="AppShell__content" data-testid="AppShell__content">
        {/*
          TODO: Kanecta components mount here. This app has no fixed view
          set — whatever gets composed in (file manager, trading view, a
          Studio view lifted out, etc.) is decided by configuration/routing
          layered on top of this shell later, not baked into it now.
        */}
      </main>
    </div>
  );
}
