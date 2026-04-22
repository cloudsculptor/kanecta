import { useState } from "react";
import { useNavigate } from "react-router-dom";
import IconButton from "@mui/material/IconButton";
import LoginDialog from "./LoginDialog";

export default function Header() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

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
          <IconButton
            aria-label="Sign in"
            onClick={() => setOpen(true)}
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
        </div>
      </header>

      <LoginDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
