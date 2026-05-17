import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { getPublicPage, type Page } from "../api/pages";
import LexicalEditor from "../components/pages/LexicalEditor";
import { usePageMeta } from "../hooks/usePageMeta";

export default function PageViewPublic() {
  const { slug } = useParams<{ slug: string }>();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  usePageMeta(page?.title || slug || "");

  useEffect(() => {
    getPublicPage(slug!)
      .then(setPage)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <>
      <Header />
      <Breadcrumb
        pageName={page?.title || slug || ""}
        parents={[
          { name: "Groups", path: "/groups" },
          { name: "Resilience", path: "/resilience/pages" },
        ]}
      />
      <main className="page-content page-view">
        {loading && <p>Loading…</p>}
        {error && <p className="pages-error">{error}</p>}
        {page && (
          <>
            <div className="page-view__header">
              {page.title && <h2 className="page-view__title">{page.title}</h2>}
            </div>
            <LexicalEditor initialState={page.content_json} editable={false} />
            <div className="page-view__footer">
              {page.group_name && <span>© {new Date().getFullYear()} {page.group_name}</span>}
              {page.licence_name && <span>{page.licence_name}</span>}
              <span>v{page.version}</span>
              <span>Updated {new Date(page.updated_at).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}</span>
            </div>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
