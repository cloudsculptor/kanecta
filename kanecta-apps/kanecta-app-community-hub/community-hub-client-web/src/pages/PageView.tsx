import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { useUserRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getPage, type Page } from "../api/pages";
import LexicalEditor from "../components/pages/LexicalEditor";

export default function PageView() {
  const { slug } = useParams<{ slug: string }>();
  const role = useUserRole();
  const { initialized } = useKeycloak();
  const navigate = useNavigate();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isTeam = role === "TEAM" || role === "MODERATOR";

  useEffect(() => {
    if (!initialized) return;
    if (role === "PUBLIC") { navigate("/", { replace: true }); return; }
    getPage(slug!)
      .then(setPage)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, role, slug, navigate]);

  return (
    <>
      <Header />
      <main className="page-content page-view">
        {loading && <p>Loading…</p>}
        {error && <p className="pages-error">{error}</p>}
        {page && (
          <>
            <div className="page-view__header">
              <div>
                {page.title && <h2 className="page-view__title">{page.title}</h2>}
              </div>
              {isTeam && (
                <Link to={`/pages/${page.slug}/edit`} className="page-view__edit-btn">
                  Edit
                </Link>
              )}
            </div>
            <LexicalEditor initialState={page.content_json} editable={false} />
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
