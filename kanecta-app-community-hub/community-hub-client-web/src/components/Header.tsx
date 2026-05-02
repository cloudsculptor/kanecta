import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import LandscapeIcon from "@mui/icons-material/Landscape";
import { useKeycloak } from "../auth/KeycloakProvider";
import { useUserRole, type UserRole } from "../auth/useUserRole";
import keycloak from "../auth/keycloak";

const ROLE_LABEL: Record<UserRole, string> = {
  PUBLIC: "Public",
  LOCAL: "Local",
  TEAM: "Team",
  RESILIENCE: "Resilience",
};

function displayName(profile: Record<string, unknown> | undefined): string {
  if (!profile) return "";
  if (typeof profile.given_name === "string") return profile.given_name;
  if (typeof profile.preferred_username === "string" && !profile.preferred_username.includes("@")) return profile.preferred_username;
  if (typeof profile.email === "string") return profile.email.split("@")[0];
  return "Account";
}

export default function Header() {
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const navigate = useNavigate();
  const { authenticated } = useKeycloak();
  const role = useUserRole();
  const profile = keycloak.idTokenParsed;

  return (
    <header className="site-header">
      <div className="site-header__brand" onClick={() => navigate("/")} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate("/")}>
        <LandscapeIcon className="site-header__mountain" />
        <span className="site-header__title">Featherston</span>
      </div>

      <div className="site-header__actions">
        {authenticated ? (
          <>
            <Button
              aria-label="Account menu"
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{
                backgroundColor: "rgba(255,255,255,0.15)",
                border: "1.5px solid rgba(255,255,255,0.35)",
                borderRadius: "999px",
                px: 1.5,
                py: "5px",
                minWidth: 0,
                gap: "6px",
                color: "#fff",
                textTransform: "none",
                fontSize: 14,
                fontWeight: 500,
                "&:hover": { backgroundColor: "rgba(255,255,255,0.25)" },
              }}
            >
              <svg viewBox="0 0 24 24" fill="#fff" width="18" height="18" aria-hidden="true">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
              {displayName(profile)}
            </Button>
            <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
              <MenuItem disabled sx={{ opacity: "1 !important", py: 1.5 }}>
                <div>
                  <div style={{ fontSize: 13, marginBottom: 6 }}>{profile?.email}</div>
                  <Chip
                    label={ROLE_LABEL[role]}
                    size="small"
                    sx={{ backgroundColor: "#3a7d44", color: "#fff", fontSize: 11, fontWeight: 600 }}
                  />
                </div>
              </MenuItem>
              <Divider />
              <MenuItem onClick={() => { setMenuAnchor(null); keycloak.logout({ redirectUri: window.location.origin }); }}>
                Sign out
              </MenuItem>
            </Menu>
          </>
        ) : (
          <>
            <Button
              onClick={() => keycloak.login()}
              sx={{
                color: "rgba(255,255,255,0.85)",
                fontWeight: 500,
                textTransform: "none",
                fontSize: 14,
                "&:hover": { color: "#fff", backgroundColor: "rgba(255,255,255,0.08)" },
              }}
            >
              Log in
            </Button>
            <Button
              onClick={() => keycloak.login()}
              variant="contained"
              sx={{
                backgroundColor: "rgba(255,255,255,0.15)",
                color: "#fff",
                fontWeight: 600,
                textTransform: "none",
                fontSize: 14,
                borderRadius: "999px",
                px: 2.5,
                boxShadow: "none",
                border: "1px solid rgba(255,255,255,0.3)",
                "&:hover": { backgroundColor: "rgba(255,255,255,0.25)", boxShadow: "none" },
              }}
            >
              Sign up
            </Button>
          </>
        )}
      </div>
    </header>
  );
}
