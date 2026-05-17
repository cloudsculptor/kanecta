import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { listPublicPages, type PageSummary } from "../api/pages";
import { usePageMeta } from "../hooks/usePageMeta";

export default function PagesListPublic() {
  usePageMeta("Community Documents");
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    listPublicPages()
      .then(setPages)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <Header />
      <Breadcrumb pageName="Community Documents" parents={[{ name: "Resilience", path: "/resilience" }]} />
      <main className="page-content">
        <h2>Community Documents</h2>
        <p className="public-pages-intro">
          Published documents from the Featherston resilience group — plans, notes, and resources available to the whole community.
        </p>
        {error && <p className="pages-error">{error}</p>}
        {loading ? (
          <p>Loading…</p>
        ) : pages.length === 0 ? (
          <p className="public-pages-empty">No public documents yet.</p>
        ) : (
          <ul className="public-pages-list">
            {pages.map((page) => (
              <li key={page.id} className="public-pages-list__item">
                <Link to={`/resilience/pages/${page.slug}`} className="public-pages-list__link">
                  <span className="public-pages-list__title">{page.title || page.slug}</span>
                  <span className="public-pages-list__meta">
                    Updated {new Date(page.updated_at).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}
                  </span>
                  <span className="public-pages-list__arrow" aria-hidden="true">→</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </>
  );
}
