import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import PageLayout from "../components/PageLayout";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getPage, createPage, updatePage } from "../api/pages";
import LexicalEditor from "../components/pages/LexicalEditor";

interface Props {
  type: "procedure" | "policy";
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function GovernancePageEdit({ type }: Props) {
  const { category, slug: routeSlug } = useParams<{ category: string; slug?: string }>();
  const isNew = !routeSlug;
  const roles = useUserRoles();
  const { initialized } = useKeycloak();
  const navigate = useNavigate();

  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [initialContent, setInitialContent] = useState<object | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [slugError, setSlugError] = useState("");
  const [uploadError, setUploadError] = useState("");

  const contentRef = useRef<object>({});
  const originalSlugRef = useRef("");

  const isModerator = hasRole(roles, "moderator");
  const ownerType = `gov-${type === "procedure" ? "proc" : "pol"}-${category}`;
  const basePath = `/governance/${type}s/${category}`;
  const categoryTitle = slugToTitle(category ?? "");

  const parents = [
    { name: "Governance", path: "/governance" },
    { name: type === "procedure" ? "Procedures" : "Policies", path: `/governance/${type}s` },
    { name: categoryTitle, path: basePath },
  ];

  useEffect(() => {
    if (!initialized) return;
    if (!isModerator) { navigate(basePath, { replace: true }); return; }
    if (isNew) return;

    getPage(routeSlug!)
      .then((page) => {
        setSlug(page.slug);
        setTitle(page.title);
        setIsPublic(page.public);
        setInitialContent(page.content_json);
        contentRef.current = page.content_json;
        originalSlugRef.current = page.slug;
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, isModerator, isNew, routeSlug, navigate, basePath]);

  function handleSlugChange(value: string) {
    const clean = value.toLowerCase().replace(/[^a-z0-9-]/g, "");
    setSlug(clean);
    if (clean && !SLUG_RE.test(clean)) {
      setSlugError("Must start and end with a letter or number");
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
        await createPage({
          slug,
          title,
          content_json: contentRef.current,
          owner_type: ownerType,
          owner_id: null,
        });
        if (isPublic) {
          await updatePage(slug, { title, content_json: contentRef.current, public: true, owner_type: ownerType, owner_id: null });
        }
      } else {
        await updatePage(originalSlugRef.current, {
          slug: slug !== originalSlugRef.current ? slug : undefined,
          title,
          content_json: contentRef.current,
          public: isPublic,
          owner_type: ownerType,
          owner_id: null,
        });
      }
      navigate(basePath);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <PageLayout pageName="Loading…" showComingSoon={false} parents={parents}>
        <p>Loading…</p>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      pageName={isNew ? `New ${type}` : `Edit: ${title}`}
      showComingSoon={false}
      parents={parents}
    >
      {error && <p className="pages-error">{error}</p>}
      {uploadError && (
        <p className="pages-error">
          {uploadError}{" "}
          <button type="button" onClick={() => setUploadError("")}>✕</button>
        </p>
      )}
      <form onSubmit={handleSave} className="page-edit__form">
        <input
          className="page-edit__title-input"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          required
        />

        <div className="page-edit__field">
          <label className="page-edit__label" htmlFor="gov-slug">
            Path
            <span className="page-edit__hint"> (a–z, 0–9, hyphens)</span>
          </label>
          <div className="page-edit__slug-preview">
            <span className="page-edit__slug-prefix">{basePath}/</span>
            <input
              id="gov-slug"
              className={`page-edit__input${slugError ? " page-edit__input--error" : ""}`}
              type="text"
              value={slug}
              required
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="my-document"
            />
          </div>
          {slugError && <p className="page-edit__field-error">{slugError}</p>}
        </div>

        <div className="page-edit__field">
          <label className="page-edit__label">Content</label>
          <LexicalEditor
            initialState={initialContent}
            onChange={(state) => { contentRef.current = state; }}
            onUploadError={(msg) => setUploadError(msg)}
          />
        </div>

        <div className="page-edit__field page-edit__publishing">
          <h3 className="page-edit__section-heading">Publishing</h3>
          <FormControlLabel
            control={
              <Switch
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
                color="success"
              />
            }
            label={isPublic ? "Public" : "Private"}
          />
        </div>

        <div className="page-edit__actions">
          <button type="submit" className="page-edit__save" disabled={saving || !!slugError}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button type="button" className="page-edit__cancel" onClick={() => navigate(basePath)}>
            Cancel
          </button>
        </div>
      </form>
    </PageLayout>
  );
}
