import { useState } from "react";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { useKeycloak } from "../auth/KeycloakProvider";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import keycloak from "../auth/keycloak";
import { prepareDownload, downloadZip } from "../api/download";
import { usePageMeta } from "../hooks/usePageMeta";

type Status = "idle" | "preparing" | "ready" | "error";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Download() {
  const { authenticated } = useKeycloak();
  const roles = useUserRoles();
  const [status, setStatus] = useState<Status>("idle");
  const [token, setToken] = useState("");
  const [size, setSize] = useState(0);
  const [error, setError] = useState("");

  usePageMeta("Download");

  const canDownload = hasRole(roles, "team");

  async function handlePrepare() {
    setStatus("preparing");
    setError("");
    try {
      const result = await prepareDownload();
      setToken(result.token);
      setSize(result.size);
      setStatus("ready");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  async function handleDownload() {
    try {
      await downloadZip(token);
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  return (
    <>
      <Header />
      <Breadcrumb pageName="Download" />
      <main className="page-content">
        <h2>Download</h2>

        {!authenticated && (
          <div className="download-gate">
            <p>You need to be logged in to download site content.</p>
            <Button variant="contained" onClick={() => keycloak.login()} sx={{ mb: 2 }}>
              Log in
            </Button>
            <p className="download-gate__signup">
              Don&apos;t have an account?{" "}
              <button className="link-button" onClick={() => keycloak.login()}>
                Sign up for free
              </button>
            </p>
          </div>
        )}

        {authenticated && !canDownload && (
          <p>This feature is available to team members only.</p>
        )}

        {authenticated && canDownload && (
          <div className="download-panel">
            <div className="download-options">
              <FormControlLabel
                control={<Checkbox defaultChecked disabled={status === "preparing"} />}
                label="Public pages"
              />
            </div>

            {status === "idle" && (
              <Button variant="contained" onClick={handlePrepare}>
                Prepare download
              </Button>
            )}

            {status === "preparing" && (
              <div className="download-preparing">
                <CircularProgress size={18} />
                <span>Preparing…</span>
              </div>
            )}

            {status === "ready" && (
              <div className="download-ready">
                <p className="download-ready__filename">
                  featherston-pages.zip &mdash; {formatSize(size)}
                </p>
                <Button variant="contained" onClick={handleDownload}>
                  Download
                </Button>
                <p className="download-ready__expiry">Link expires in 5 minutes</p>
              </div>
            )}

            {status === "error" && (
              <div className="download-error">
                <p className="pages-error">{error}</p>
                <Button onClick={() => setStatus("idle")}>Try again</Button>
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}
