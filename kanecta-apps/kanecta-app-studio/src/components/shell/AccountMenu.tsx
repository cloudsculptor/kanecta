import { useState } from 'react';
import Avatar from '@mui/material/Avatar';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useKeycloak } from '../../auth/KeycloakProvider';
import { useUserRoles, primaryRole } from '../../auth/useUserRole';
import keycloak from '../../auth/keycloak';
import './AccountMenu.scss';

function displayName(profile: Record<string, unknown> | undefined): string {
  if (!profile) return '';
  if (typeof profile.given_name === 'string') return profile.given_name;
  if (typeof profile.preferred_username === 'string' && !profile.preferred_username.includes('@')) return profile.preferred_username;
  if (typeof profile.email === 'string') return profile.email.split('@')[0];
  return 'Account';
}

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

// Avatar + dropdown menu in the top-right of the TopBar, modeled on
// community-hub's Header account menu — shows the signed-in user, their
// primary role, and a sign-out action. Hidden entirely when auth is
// disabled (VITE_AUTH_DISABLED=true): there's no Keycloak session to show.
export function AccountMenu() {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const { authenticated, authDisabled } = useKeycloak();
  const roles = useUserRoles();
  const profile = keycloak.idTokenParsed;
  const name = displayName(profile);
  const primary = primaryRole(roles);

  if (authDisabled) return null;

  if (!authenticated) {
    return (
      <Button
        className="AccountMenu-login"
        onClick={() => keycloak.login()}
        aria-label="Log in"
      >
        Log in
      </Button>
    );
  }

  return (
    <>
      <IconButton
        className="AccountMenu-trigger"
        aria-label="Account menu"
        onClick={(e) => setMenuAnchor(e.currentTarget)}
      >
        <Avatar className="AccountMenu-avatar">{initials(name || 'U')}</Avatar>
      </IconButton>
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
        <MenuItem disabled className="AccountMenu-header">
          <div>
            <div className="AccountMenu-email">{typeof profile?.email === 'string' ? profile.email : name}</div>
            {primary && <Chip label={primary} size="small" className="AccountMenu-role-chip" />}
          </div>
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { setMenuAnchor(null); keycloak.logout({ redirectUri: window.location.origin }); }}>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}
