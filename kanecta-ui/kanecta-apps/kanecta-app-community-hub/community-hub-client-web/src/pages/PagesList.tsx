import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { listPages, deletePage, type PageSummary } from "../api/pages";

export default function PagesList() {
  const roles = useUserRoles();
  const { initialized } = useKeycloak();
  const navigate = useNavigate();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isTeam = hasRole(roles, "team");

  function renderSection(items: PageSummary[], label: string) {
    if (!items.length) return null;
    return (
      <>
        <div className="nav-divider"><span>{label}</span></div>
        <ul className="pages-list">
          {items.map((page) => (
            <li key={page.id} className="pages-list__item">
              <div className="pages-list__info">
                <div className="pages-list__title-row">
                  <Link to={`/groups/resilience/${page.slug}`} className="pages-list__title">
                    {page.title || page.slug}
                  </Link>
                  <Chip
                    label={page.public ? "Public" : "Team"}
                    color={page.public ? "success" : "default"}
                    variant={page.public ? "filled" : "outlined"}
                    size="small"
                    sx={{ ml: 1 }}
                  />
                  <Chip
                    label={`v${page.version}`}
                    size="small"
                    variant="outlined"
                    sx={{ ml: 0.5 }}
                  />
                </div>
                <span className="pages-list__meta">
                  by {page.created_by_name} · {new Date(page.updated_at).toLocaleDateString("en-NZ")}
                </span>
              </div>
              <div className="pages-list__actions">
                <Link to={`/groups/resilience/${page.slug}/edit`} className="pages-list__btn">Edit</Link>
                <button
                  type="button"
                  className="pages-list__btn pages-list__btn--del"
                  onClick={() => handleDelete(page.slug)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  }

  useEffect(() => {
    if (!initialized) return;
    if (!isTeam) { navigate("/resilience/pages", { replace: true }); return; }
    listPages()
      .then((all) => setPages(all.filter((p) => p.owner_type === "group" || p.owner_type === "private")))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, isTeam, navigate]);

  async function handleDelete(slug: string) {
    if (!confirm(`Delete page "${slug}"?`)) return;
    try {
      await deletePage(slug);
      setPages((ps) => ps.filter((p) => p.slug !== slug));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <Header />
      <Breadcrumb pageName="Resilience" parents={[{ name: "Groups", path: "/groups" }]} />
      <main className="page-content">
        <div className="pages-header">
          <h2>Resilience</h2>
          <div className="pages-header__actions">
            <Link to="/discussions" className="pages-outline-btn">Discussions</Link>
            <Link to="/groups/resilience/new" className="pages-new-btn">+ New page</Link>
          </div>
        </div>
        <Alert severity="info" sx={{ mb: 2 }}>
          You are viewing this page as a logged-in team member. The public view looks different —
          log out to see what members of the public see.
        </Alert>
        {error && <p className="pages-error">{error}</p>}
        {loading ? (
          <p>Loading…</p>
        ) : pages.length === 0 ? (
          <p className="pages-empty">No pages yet. Create the first one.</p>
        ) : (
          <>
            {renderSection(pages.filter(p => p.public).sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug)), "Visible to the public")}
            {renderSection(pages.filter(p => !p.public).sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug)), "Visible to team members only")}
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
