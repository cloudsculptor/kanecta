import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getPublicPage, getPage, type Page } from "../api/pages";
import LexicalEditor from "../components/pages/LexicalEditor";

interface Props {
  type: "procedure" | "policy";
}

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function GovernancePageView({ type }: Props) {
  const { category, slug } = useParams<{ category: string; slug: string }>();
  const roles = useUserRoles();
  const { initialized, authenticated } = useKeycloak();
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const isModerator = hasRole(roles, "moderator");
  const basePath = `/governance/${type === "policy" ? "policies" : "procedures"}/${category}`;
  const categoryTitle = slugToTitle(category ?? "");

  const parents = [
    { name: "Governance", path: "/governance" },
    { name: type === "procedure" ? "Procedures" : "Policies", path: `/governance/${type === "policy" ? "policies" : "procedures"}` },
    { name: categoryTitle, path: basePath },
  ];

  useEffect(() => {
    if (!initialized) return;
    const fetch =
      authenticated && isModerator
        ? getPage(slug!)
        : getPublicPage(slug!);

    fetch
      .then(setPage)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, authenticated, isModerator, slug]);

  const title = page?.title || slugToTitle(slug ?? "");

  return (
    <PageLayout
      pageName={title}
      showComingSoon={false}
      showHeading={false}
      parents={parents}
    >
      {loading && <p>Loading…</p>}
      {error && <p className="pages-error">{error}</p>}
      {page && (
        <>
          <div className="page-view__header">
            <h2 className="page-view__title">{title}</h2>
            {isModerator && !page.archived_at && (
              <Link to={`${basePath}/${page.slug}/edit`} className="page-view__edit-btn">
                Edit
              </Link>
            )}
          </div>
          <LexicalEditor initialState={page.content_json} editable={false} />
          <div className="page-view__footer">
            <span>v{page.version}</span>
            <span>Updated {new Date(page.updated_at).toLocaleDateString("en-NZ", { day: "numeric", month: "long", year: "numeric" })}</span>
          </div>
        </>
      )}
    </PageLayout>
  );
}
