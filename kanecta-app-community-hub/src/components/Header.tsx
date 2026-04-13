import { useState } from "react";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <header className="site-header">
        <div className="site-header__spacer" />
        <div className="site-header__center">
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

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>Sign up & Login</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The ability to log in and directly contribute is coming soon.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
