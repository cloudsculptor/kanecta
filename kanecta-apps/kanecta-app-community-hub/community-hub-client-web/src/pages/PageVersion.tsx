import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { useUserRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getPageVersion, type PageVersionData } from "../api/pages";
import LexicalEditor from "../components/pages/LexicalEditor";

const ACTION_COLOR: Record<string, "success" | "warning" | "info" | "default" | "error"> = {
  Published: "success",
  Unpublished: "warning",
  Created: "info",
  Updated: "default",
  Archived: "error",
};

const breadcrumbParents = [{ name: "Groups", path: "/groups" }];

export default function PageVersion() {
  const { slug, version: versionParam } = useParams<{ slug: string; version: string }>();
  const role = useUserRole();
  const { initialized } = useKeycloak();
  const navigate = useNavigate();

  const [data, setData] = useState<PageVersionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isTeam = role === "TEAM" || role === "MODERATOR";

  useEffect(() => {
    if (!initialized) return;
    if (!isTeam) { navigate("/", { replace: true }); return; }
    getPageVersion(slug!, parseInt(versionParam!, 10))
      .then(setData)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, isTeam, slug, versionParam, navigate]);

  return (
    <>
      <Header />
      <Breadcrumb pageName={`v${versionParam}`} parents={breadcrumbParents} />
      <main className="page-content">
        <div className="pages-header">
          <h2>{data?.title || `Version ${versionParam}`}</h2>
          <div className="page-version__actions">
            <Button
              component={Link}
              to={`/groups/resilience/${slug}`}
              variant="contained"
              color="success"
              size="small"
            >
              View current page
            </Button>
            <Link to={`/groups/resilience/${slug}/history`} className="pages-outline-btn">
              ← History
            </Link>
          </div>
        </div>

        {error && <p className="pages-error">{error}</p>}
        {loading && <p>Loading…</p>}

        {data && (
          <>
            <Alert severity="warning" sx={{ mb: 3 }}>
              <AlertTitle>You are viewing a historic version of this page</AlertTitle>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
                <Chip
                  label={data.action}
                  color={ACTION_COLOR[data.action] ?? "default"}
                  size="small"
                />
                <Typography variant="body2" component="span">
                  by {data.user_name} · {new Date(data.created_at).toLocaleString("en-NZ")}
                </Typography>
                {data.licence_name && (
                  <Typography variant="body2" component="span">
                    · {data.licence_name}
                  </Typography>
                )}
              </Box>
            </Alert>
            <LexicalEditor
              initialState={data.content_json}
              editable={false}
            />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
