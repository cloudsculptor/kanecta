import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth0 } from "@auth0/auth0-react";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useUserRole, type UserRole } from "../auth/useUserRole";

const ROLE_LABEL: Record<UserRole, string> = {
  PUBLIC: "Public",
  LOCAL: "Local",
  TEAM: "Team",
};

const ROLE_COLOR: Record<UserRole, string> = {
  PUBLIC: "#757575",
  LOCAL: "#2e7d32",
  TEAM: "#3a7d44",
};

export default function Header() {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const { isAuthenticated, user, logout, loginWithRedirect } = useAuth0();
  const role = useUserRole();

  return (
    <>
      <header className="site-header">
        <div className="site-header__spacer" />
        <div
          className="site-header__center"
          onClick={() => navigate("/")}
          style={{ cursor: "pointer" }}
        >
          <h1 className="site-header__title">Featherston</h1>
          <p className="site-header__subtitle">Community Information Hub</p>
        </div>
        <div className="site-header__actions">
          {isAuthenticated ? (
            <>
              <IconButton
                aria-label="Account menu"
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                sx={{
                  color: ROLE_COLOR[role],
                  "&:hover": {
                    color: "#fff",
                    backgroundColor: "rgba(255,255,255,0.12)",
                  },
                }}
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  width="26"
                  height="26"
                  aria-hidden="true"
                >
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </IconButton>
              <Menu
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={() => setMenuAnchor(null)}
              >
                <MenuItem disabled sx={{ opacity: "1 !important", py: 1.5 }}>
                  <div>
                    <div style={{ fontSize: 13, marginBottom: 6 }}>
                      {user?.email}
                    </div>
                    <Chip
                      label={ROLE_LABEL[role]}
                      size="small"
                      sx={{
                        backgroundColor: ROLE_COLOR[role],
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    />
                  </div>
                </MenuItem>
                <Divider />
                <MenuItem
                  onClick={() => {
                    setMenuAnchor(null);
                    logout({ logoutParams: { returnTo: window.location.origin } });
                  }}
                >
                  Sign out
                </MenuItem>
              </Menu>
            </>
          ) : (
            <IconButton
              aria-label="Sign in"
              onClick={() => loginWithRedirect()}
              sx={{
                color: "rgba(255,255,255,0.8)",
                "&:hover": {
                  color: "#fff",
                  backgroundColor: "rgba(255,255,255,0.12)",
                },
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                width="26"
                height="26"
                aria-hidden="true"
              >
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </IconButton>
          )}
        </div>
      </header>

    </>
  );
}
