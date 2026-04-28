import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import { useAuth0 } from "@auth0/auth0-react";

export default function ComingSoon() {
  const { loginWithRedirect } = useAuth0();

  return (
    <Alert severity="info" sx={{ mb: 3 }}>
      Content, and the ability to{" "}
      <Link
        component="button"
        onClick={() => loginWithRedirect()}
        sx={{ verticalAlign: "baseline", fontWeight: 500 }}
      >
        log in
      </Link>{" "}
      and contribute directly coming soon.
    </Alert>
  );
}
