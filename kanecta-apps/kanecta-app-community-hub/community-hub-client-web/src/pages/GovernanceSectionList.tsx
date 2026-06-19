import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Chip from "@mui/material/Chip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import PageLayout from "../components/PageLayout";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import {
  listPages,
  listPublicPages,
  archivePage,
  unarchivePage,
  type PageSummary,
} from "../api/pages";

interface Props {
  type: "procedure" | "policy";
}

function slugToTitle(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const PARENTS_BY_TYPE = {
  procedure: [
    { name: "Governance", path: "/governance" },
    { name: "Procedures", path: "/governance/procedures" },
  ],
  policy: [
    { name: "Governance", path: "/governance" },
    { name: "Policies", path: "/governance/policies" },
  ],
};

export default function GovernanceSectionList({ type }: Props) {
  const { category } = useParams<{ category: string }>();
  const roles = useUserRoles();
  const { initialized, authenticated } = useKeycloak();
  const [pages, setPages] = useState<PageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const isModerator = hasRole(roles, "moderator");
  const ownerType = `gov-${type === "procedure" ? "proc" : "pol"}-${category}`;
  const basePath = `/governance/${type}s/${category}`;
  const categoryTitle = slugToTitle(category ?? "");
  const parents = PARENTS_BY_TYPE[type];

  useEffect(() => {
    if (!initialized) return;

    const fetch =
      authenticated && isModerator
        ? listPages(showArchived).then((ps) => ps.filter((p) => p.owner_type === ownerType))
        : listPublicPages(showArchived).then((ps) => ps.filter((p) => p.owner_type === ownerType));

    fetch
      .then(setPages)
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [initialized, authenticated, isModerator, ownerType, showArchived]);

  async function handleArchive(slug: string) {
    if (!confirm(`Archive this item?`)) return;
    try {
      await archivePage(slug);
      setPages((ps) => ps.filter((p) => p.slug !== slug));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUnarchive(slug: string) {
    try {
      await unarchivePage(slug);
      setPages((ps) =>
        ps.map((p) => (p.slug === slug ? { ...p, archived_at: null } : p))
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const active = pages.filter((p) => !p.archived_at);
  const archived = pages.filter((p) => p.archived_at);

  return (
    <PageLayout pageName={categoryTitle} showComingSoon={false} wip parents={parents}>
      {isModerator && (
        <div className="pages-header">
          <div className="pages-header__actions">
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
              }
              label="Show archived"
            />
            <Link to={`${basePath}/new`} className="pages-new-btn">+ New</Link>
          </div>
        </div>
      )}

      {error && <p className="pages-error">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : active.length === 0 && archived.length === 0 ? (
        <p className="pages-empty">No documents yet.{isModerator ? " Create the first one." : ""}</p>
      ) : (
        <>
          <ul className="pages-list">
            {active
              .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug))
              .map((page) => (
                <li key={page.id} className="pages-list__item">
                  <div className="pages-list__info">
                    <div className="pages-list__title-row">
                      <Link to={`${basePath}/${page.slug}`} className="pages-list__title">
                        {page.title || page.slug}
                      </Link>
                      {isModerator && (
                        <Chip
                          label={page.public ? "Public" : "Private"}
                          color={page.public ? "success" : "default"}
                          variant={page.public ? "filled" : "outlined"}
                          size="small"
                          sx={{ ml: 1 }}
                        />
                      )}
                    </div>
                    <span className="pages-list__meta">
                      by {page.created_by_name} · {new Date(page.updated_at).toLocaleDateString("en-NZ")}
                    </span>
                  </div>
                  {isModerator && (
                    <div className="pages-list__actions">
                      <Link to={`${basePath}/${page.slug}/edit`} className="pages-list__btn">Edit</Link>
                      <button
                        type="button"
                        className="pages-list__btn pages-list__btn--del"
                        onClick={() => handleArchive(page.slug)}
                      >
                        Archive
                      </button>
                    </div>
                  )}
                </li>
              ))}
          </ul>

          {showArchived && archived.length > 0 && (
            <>
              <div className="nav-divider"><span>Archived</span></div>
              <ul className="pages-list">
                {archived
                  .sort((a, b) => (a.title || a.slug).localeCompare(b.title || b.slug))
                  .map((page) => (
                    <li key={page.id} className="pages-list__item pages-list__item--archived">
                      <div className="pages-list__info">
                        <div className="pages-list__title-row">
                          <span className="pages-list__title pages-list__title--archived">
                            {page.title || page.slug}
                          </span>
                          <Chip label="Archived" size="small" variant="outlined" sx={{ ml: 1 }} />
                        </div>
                        <span className="pages-list__meta">
                          by {page.created_by_name} · {new Date(page.updated_at).toLocaleDateString("en-NZ")}
                        </span>
                      </div>
                      {isModerator && (
                        <div className="pages-list__actions">
                          <button
                            type="button"
                            className="pages-list__btn"
                            onClick={() => handleUnarchive(page.slug)}
                          >
                            Restore
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </>
          )}
        </>
      )}
    </PageLayout>
  );
}
