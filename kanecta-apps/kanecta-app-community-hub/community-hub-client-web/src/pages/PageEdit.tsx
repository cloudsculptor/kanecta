import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { useUserRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getPage, createPage, updatePage } from "../api/pages";
import LexicalEditor from "../components/pages/LexicalEditor";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

export default function PageEdit() {
  const { slug: routeSlug } = useParams<{ slug?: string }>();
  const isNew = !routeSlug;

  const role = useUserRole();
  const { initialized } = useKeycloak();
  const navigate = useNavigate();

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [initialContent, setInitialContent] = useState<object | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [slugError, setSlugError] = useState("");
  const [uploadError, setUploadError] = useState("");

  const contentRef = useRef<object>({});
  const originalSlugRef = useRef("");

  const isTeam = role === "TEAM" || role === "MODERATOR";

  useEffect(() => {
    if (!initialized) return;
    if (!isTeam) { navigate("/", { replace: true }); return; }
    if (isNew) return;
    getPage(routeSlug!)
      .then((page) => {
        setSlug(page.slug);
        setTitle(page.title);
        setInitialContent(page.content_json);
        contentRef.current = page.content_json;
        originalSlugRef.current = page.slug;
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, isTeam, isNew, routeSlug, navigate]);

  function handleSlugChange(value: string) {
    const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlug(clean);
    if (clean && !SLUG_RE.test(clean)) {
      setSlugError("Slugs must start and end with a letter or number");
    } else {
      setSlugError("");
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!SLUG_RE.test(slug)) { setSlugError("Invalid slug"); return; }
    setSaving(true);
    setError("");
    try {
      if (isNew) {
        await createPage({ slug, title, content_json: contentRef.current });
      } else {
        await updatePage(originalSlugRef.current, {
          slug: slug !== originalSlugRef.current ? slug : undefined,
          title,
          content_json: contentRef.current,
        });
      }
      navigate("/groups/resilience");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <Header />
        <main className="page-content"><p>Loading…</p></main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main className="page-content page-edit">
        <h2>{isNew ? "New page" : `Editing ${originalSlugRef.current}`}</h2>
        {error && <p className="pages-error">{error}</p>}
        {uploadError && <p className="pages-error">{uploadError} <button type="button" onClick={() => setUploadError("")}>✕</button></p>}
        <form onSubmit={handleSave} className="page-edit__form">
          <div className="page-edit__field">
            <label className="page-edit__label" htmlFor="pe-slug">
              Page slug
              <span className="page-edit__hint"> (a–z, 0–9, hyphens)</span>
            </label>
            <div className="page-edit__slug-preview">
              <span className="page-edit__slug-prefix">/groups/resilience/</span>
              <input
                id="pe-slug"
                className={`page-edit__input${slugError ? " page-edit__input--error" : ""}`}
                type="text"
                value={slug}
                required
                onChange={(e) => handleSlugChange(e.target.value)}
                placeholder="my-page-name"
              />
            </div>
            {slugError && <p className="page-edit__field-error">{slugError}</p>}
          </div>

          <div className="page-edit__field">
            <label className="page-edit__label" htmlFor="pe-title">Title</label>
            <input
              id="pe-title"
              className="page-edit__input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Page title (optional)"
            />
          </div>

          <div className="page-edit__field">
            <label className="page-edit__label">Content</label>
            <LexicalEditor
              initialState={initialContent}
              onChange={(state) => { contentRef.current = state; }}
              onUploadError={(msg) => setUploadError(msg)}
            />
          </div>

          <div className="page-edit__actions">
            <button type="submit" className="page-edit__save" disabled={saving || !!slugError}>
              {saving ? "Saving…" : "Save page"}
            </button>
            <button type="button" className="page-edit__cancel" onClick={() => navigate("/pages")}>
              Cancel
            </button>
          </div>
        </form>
      </main>
      <Footer />
    </>
  );
}
