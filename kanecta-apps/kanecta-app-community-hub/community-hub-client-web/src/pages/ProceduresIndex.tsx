import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { getSiteNodeTree, swapSiteNodeOrder, deleteSiteNode, type SiteNode } from "../api/site-nodes";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import SiteNodeEditor from "../components/SiteNodeEditor";
import SiteNodeControls from "../components/SiteNodeControls";

export default function ProceduresIndex() {
  const roles = useUserRoles();
  const isModerator = hasRole(roles, "moderator");
  const [tree, setTree] = useState<SiteNode | null>(null);
  const [error, setError] = useState("");

  function reload() {
    getSiteNodeTree("procedures")
      .then(setTree)
      .catch((err: Error) => setError(err.message));
  }

  useEffect(reload, []);

  const groups = tree?.children ?? [];

  return (
    <PageLayout pageName="Procedures" showComingSoon={false} parents={[{ name: "Governance", path: "/governance" }]}>
      {error && <p className="pages-error">{error}</p>}
      {groups.map((group, gi) => (
        <div key={group.id} className="policy-group">
          <h3 className="policy-group__heading">
            {group.title}
            {isModerator && (
              <>
                <SiteNodeEditor mode="rename" node={group} onSaved={reload} />
                <SiteNodeControls
                  node={group}
                  siblings={groups}
                  index={gi}
                  onMove={async (dir) => { await swapSiteNodeOrder(groups, group.id, dir); reload(); }}
                  onDelete={async () => { await deleteSiteNode(group.id); reload(); }}
                />
              </>
            )}
          </h3>
          <div className="role-index">
            {group.children.map((cat, ci) => (
              <div key={cat.id} className="role-index__item-wrap">
                <Link to={`/governance/procedures/${cat.slug}`} className="role-index__item">
                  <span className="role-index__title">{cat.title}</span>
                  {cat.metadata.description && (
                    <span className="role-index__description">{cat.metadata.description}</span>
                  )}
                  <span className="role-index__arrow">→</span>
                </Link>
                {isModerator && (
                  <div className="role-index__mod-controls">
                    <SiteNodeEditor mode="rename" node={cat} onSaved={reload} />
                    <SiteNodeControls
                      node={cat}
                      siblings={group.children}
                      index={ci}
                      onMove={async (dir) => { await swapSiteNodeOrder(group.children, cat.id, dir); reload(); }}
                      onDelete={async () => { await deleteSiteNode(cat.id); reload(); }}
                    />
                  </div>
                )}
              </div>
            ))}
            {isModerator && (
              <SiteNodeEditor mode="add-category" parentNode={group} govType="procedure" onSaved={reload} />
            )}
          </div>
        </div>
      ))}
      {isModerator && (
        <SiteNodeEditor mode="add-group" parentNode={tree ?? undefined} onSaved={reload} />
      )}
    </PageLayout>
  );
}
