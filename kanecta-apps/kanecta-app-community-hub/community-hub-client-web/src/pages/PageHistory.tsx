import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import Chip from "@mui/material/Chip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { listPageHistory, type PageHistoryEntry } from "../api/pages";

const ACTION_COLOR: Record<string, "success" | "warning" | "info" | "default" | "error"> = {
  Published: "success",
  Unpublished: "warning",
  Created: "info",
  Updated: "default",
  Archived: "error",
};

export default function PageHistory() {
  const { slug } = useParams<{ slug: string }>();
  const { pathname } = useLocation();
  const isSiteContext = pathname.startsWith("/site-pages/");
  const roles = useUserRoles();
  const { initialized } = useKeycloak();
  const navigate = useNavigate();

  const [history, setHistory] = useState<PageHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isTeam = hasRole(roles, "team");
  const isModerator = hasRole(roles, "moderator");
  const canView = isTeam || isModerator;

  const breadcrumbParents = isSiteContext ? [] : [{ name: "Groups", path: "/groups" }];
  const editPath = isSiteContext ? `/site-pages/${slug}/edit` : `/groups/resilience/${slug}/edit`;
  const versionBasePath = isSiteContext ? `/site-pages/${slug}/v` : `/groups/resilience/${slug}/v`;

  useEffect(() => {
    if (!initialized) return;
    if (!canView) { navigate("/", { replace: true }); return; }
    listPageHistory(slug!)
      .then(setHistory)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, canView, slug, navigate]);

  return (
    <>
      <Header />
      <Breadcrumb pageName="Page history" parents={breadcrumbParents} />
      <main className="page-content">
        <div className="pages-header">
          <h2>Page history</h2>
          <Link to={editPath} className="pages-outline-btn">← Edit page</Link>
        </div>
        {error && <p className="pages-error">{error}</p>}
        {loading ? (
          <p>Loading…</p>
        ) : history.length === 0 ? (
          <p className="pages-empty">No history yet.</p>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Action</TableCell>
                <TableCell>Version</TableCell>
                <TableCell>User</TableCell>
                <TableCell>Licence</TableCell>
                <TableCell>Date</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {history.map((entry) => (
                <TableRow
                  key={entry.id}
                  hover
                  sx={{ cursor: "pointer" }}
                  onClick={() => navigate(`${versionBasePath}/${entry.version}`)}
                >
                  <TableCell>
                    <Chip
                      label={entry.action}
                      color={ACTION_COLOR[entry.action] ?? "default"}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>v{entry.version}</TableCell>
                  <TableCell>{entry.user_name}</TableCell>
                  <TableCell>{entry.licence_name ?? "—"}</TableCell>
                  <TableCell>
                    {new Date(entry.created_at).toLocaleString("en-NZ")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </main>
      <Footer />
    </>
  );
}
