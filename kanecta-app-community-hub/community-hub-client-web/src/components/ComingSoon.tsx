import Alert from "@mui/material/Alert";
import Link from "@mui/material/Link";
import keycloak from "../auth/keycloak";

export default function ComingSoon() {
  return (
    <Alert severity="info" sx={{ mb: 3 }}>
      Content, and the ability to{" "}
      <Link
        component="button"
        onClick={() => keycloak.login()}
        sx={{ verticalAlign: "baseline", fontWeight: 500 }}
      >
        log in
      </Link>{" "}
      and contribute directly coming soon.
    </Alert>
  );
}
