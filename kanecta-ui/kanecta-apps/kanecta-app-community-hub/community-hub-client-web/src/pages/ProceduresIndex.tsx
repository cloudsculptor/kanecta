import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";
import { getSiteNodeTree, swapSiteNodeOrder, deleteSiteNode, type SiteNode } from "../api/site-nodes";
import { listPublicPages } from "../api/pages";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import SiteNodeEditor from "../components/SiteNodeEditor";
import SiteNodeMenu from "../components/SiteNodeMenu";

export default function ProceduresIndex() {
  const roles = useUserRoles();
  const isModerator = hasRole(roles, "moderator");
  const [tree, setTree] = useState<SiteNode | null>(null);
  const [pageCounts, setPageCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState("");

  function reload() {
    getSiteNodeTree("procedures")
      .then(setTree)
      .catch((err: Error) => setError(err.message));
    listPublicPages().then((pages) => {
      const counts: Record<string, number> = {};
      pages.forEach((p) => {
        const m = p.owner_type?.match(/^gov-proc-(.+)$/);
        if (m) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
      });
      setPageCounts(counts);
    });
  }

  useEffect(reload, []);

  const groups = tree?.children ?? [];

  return (
    <PageLayout pageName="Procedures" showComingSoon={false} parents={[{ name: "Governance", path: "/governance" }]}>
      {error && <p className="pages-error">{error}</p>}
      {groups.map((group, gi) => (
        <div key={group.id} className="policy-group">
          <div className="policy-group__heading-row">
            <h3 className="policy-group__heading">{group.title}</h3>
            {isModerator && (
              <SiteNodeMenu
                node={group}
                siblings={groups}
                index={gi}
                govType="procedure"
                onMove={async (dir) => { await swapSiteNodeOrder(groups, group.id, dir); reload(); }}
                onDelete={async () => { await deleteSiteNode(group.id); reload(); }}
                onSaved={reload}
              />
            )}
          </div>
          <div className="role-index">
            {group.children.map((cat, ci) => {
              const count = pageCounts[cat.slug] ?? 0;
              return (
                <div key={cat.id} className="role-index__item-wrap">
                  <Link to={`/governance/procedures/${cat.slug}`} className="role-index__item">
                    <span className="role-index__title">{cat.title}</span>
                    {cat.metadata.description && (
                      <span className="role-index__description">{cat.metadata.description}</span>
                    )}
                  </Link>
                  <div className="role-index__right">
                    {isModerator ? (
                      <SiteNodeMenu
                        node={cat}
                        siblings={group.children}
                        index={ci}
                        pageCount={count}
                        onMove={async (dir) => { await swapSiteNodeOrder(group.children, cat.id, dir); reload(); }}
                        onDelete={async () => { await deleteSiteNode(cat.id); reload(); }}
                        onSaved={reload}
                      />
                    ) : (
                      <span className="role-index__arrow">→</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {isModerator && (
        <SiteNodeEditor mode="add-group" parentNode={tree ?? undefined} onSaved={reload} />
      )}
    </PageLayout>
  );
}
