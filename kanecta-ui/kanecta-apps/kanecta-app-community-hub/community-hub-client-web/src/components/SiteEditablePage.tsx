import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { getPublicPage, type Page } from "../api/pages";
import LexicalEditor from "./pages/LexicalEditor";

interface Props {
  slug: string;
  title?: string;
  children: ReactNode;
}

function hasContent(contentJson: object): boolean {
  return "root" in contentJson;
}

export default function SiteEditablePage({ slug, title, children }: Props) {
  const [dbPage, setDbPage] = useState<Page | null>(null);
  const roles = useUserRoles();
  const isModerator = hasRole(roles, "moderator");

  useEffect(() => {
    getPublicPage(slug)
      .then((page) => { if (page.owner_type === "site") setDbPage(page); })
      .catch(() => {});
  }, [slug]);

  const editLink = isModerator && dbPage
    ? <Link to={`/site-pages/${slug}/edit`} className="site-page__edit-link">Edit this page</Link>
    : null;

  return (
    <div className="site-page">
      {title && (
        <div className="site-page__heading-row">
          <h2 className="site-page__title">{title}</h2>
          {editLink}
        </div>
      )}
      {!title && editLink && (
        <div className="site-page__edit-bar">{editLink}</div>
      )}
      {dbPage && hasContent(dbPage.content_json) ? (
        <div className="site-page__content">
          <LexicalEditor initialState={dbPage.content_json} editable={false} />
        </div>
      ) : (
        children
      )}
    </div>
  );
}
