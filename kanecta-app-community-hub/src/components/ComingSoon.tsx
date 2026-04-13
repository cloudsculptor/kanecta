import { useState } from "react";
import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import LoginDialog from "./LoginDialog";

export default function ComingSoon() {
  const [loginOpen, setLoginOpen] = useState(false);

  return (
    <>
      <Alert severity="info" sx={{ mb: 3 }}>
        Content, and the ability to{" "}
        <Link
          component="button"
          onClick={() => setLoginOpen(true)}
          sx={{ verticalAlign: "baseline", fontWeight: 500 }}
        >
          log in
        </Link>{" "}
        and contribute directly coming soon.
      </Alert>

      <LoginDialog open={loginOpen} onClose={() => setLoginOpen(false)} />
    </>
  );
}
