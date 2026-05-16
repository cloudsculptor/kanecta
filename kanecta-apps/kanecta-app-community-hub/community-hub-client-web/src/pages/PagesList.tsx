import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { useUserRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { listPages, deletePage, type PageSummary } from "../api/pages";

export default function PagesList() {
  const role = useUserRole();
  const { initialized } = useKeycloak();
  const navigate = useNavigate();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isTeam = role === "TEAM" || role === "MODERATOR";

  useEffect(() => {
    if (!initialized) return;
    if (!isTeam) { navigate("/", { replace: true }); return; }
    listPages()
      .then(setPages)
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
            <Link to="/pages/new" className="pages-new-btn">+ New page</Link>
            <Link to="/discussions" className="pages-outline-btn">Discussions</Link>
          </div>
        </div>
        {error && <p className="pages-error">{error}</p>}
        {loading ? (
          <p>Loading…</p>
        ) : pages.length === 0 ? (
          <p className="pages-empty">No pages yet. Create the first one.</p>
        ) : (
          <ul className="pages-list">
            {pages.map((page) => (
              <li key={page.id} className="pages-list__item">
                <div className="pages-list__info">
                  <Link to={`/groups/resilience/${page.slug}`} className="pages-list__slug">
                    {page.slug}
                  </Link>
                  {page.title && <span className="pages-list__title">{page.title}</span>}
                  <span className="pages-list__meta">
                    by {page.created_by_name} · {new Date(page.updated_at).toLocaleDateString("en-NZ")}
                  </span>
                </div>
                <div className="pages-list__actions">
                  <Link to={`/pages/${page.slug}/edit`} className="pages-list__btn">Edit</Link>
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
        )}
      </main>
      <Footer />
    </>
  );
}
