import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Chip from "@mui/material/Chip";
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
          <h2>Version {versionParam}</h2>
          <Link to={`/groups/resilience/${slug}/history`} className="pages-outline-btn">← History</Link>
        </div>

        {error && <p className="pages-error">{error}</p>}
        {loading && <p>Loading…</p>}

        {data && (
          <>
            <div className="page-version__meta">
              <Chip
                label={data.action}
                color={ACTION_COLOR[data.action] ?? "default"}
                size="small"
              />
              <span className="page-version__meta-text">
                by {data.user_name} · {new Date(data.created_at).toLocaleString("en-NZ")}
              </span>
              {data.licence_name && (
                <span className="page-version__meta-text">{data.licence_name}</span>
              )}
            </div>
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
