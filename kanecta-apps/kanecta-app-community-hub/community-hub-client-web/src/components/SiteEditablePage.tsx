import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { getPublicPage, type Page } from "../api/pages";
import LexicalEditor from "./pages/LexicalEditor";

interface Props {
  slug: string;
  children: ReactNode;
}

function hasContent(contentJson: object): boolean {
  return "root" in contentJson;
}

export default function SiteEditablePage({ slug, children }: Props) {
  const [dbPage, setDbPage] = useState<Page | null>(null);
  const roles = useUserRoles();
  const isModerator = hasRole(roles, "moderator");

  useEffect(() => {
    getPublicPage(slug)
      .then((page) => { if (page.owner_type === "site") setDbPage(page); })
      .catch(() => {});
  }, [slug]);

  return (
    <>
      {isModerator && dbPage && (
        <div className="site-page__edit-bar">
          <Link to={`/site-pages/${slug}/edit`} className="site-page__edit-link">
            Edit this page
          </Link>
        </div>
      )}
      {dbPage && hasContent(dbPage.content_json) ? (
        <LexicalEditor initialState={dbPage.content_json} editable={false} />
      ) : (
        children
      )}
    </>
  );
}
