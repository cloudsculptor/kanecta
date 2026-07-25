import type { SiteNode } from "../api/site-nodes";

// Site-node tree fixtures mirroring the real governance seed data
// (migrations 031/034/035): group → category two-level trees under each
// governance root. Shared by the governance index/menu/editor stories.

let n = 0;
export function makeNode(partial: Partial<SiteNode> & Pick<SiteNode, "slug" | "title">): SiteNode {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    parent_id: null,
    node_type: "index",
    component_name: null,
    metadata: {},
    sort_order: n,
    public: true,
    children: [],
    ...partial,
  };
}

export function minutesTree(): SiteNode {
  return makeNode({
    slug: "minutes",
    title: "Meeting Minutes",
    children: [
      makeNode({
        slug: "custodian-board",
        title: "Custodian Board",
        metadata: { level: "group" },
        children: [
          makeNode({
            slug: "custodian-board-2026",
            title: "2026",
            metadata: { level: "category", description: "Custodian Board meeting minutes from 2026." },
          }),
        ],
      }),
      makeNode({
        slug: "volunteers",
        title: "Volunteers",
        metadata: { level: "group" },
        children: [
          makeNode({
            slug: "volunteers-2026",
            title: "2026",
            metadata: { level: "category", description: "Volunteer team meeting minutes from 2026." },
          }),
        ],
      }),
    ],
  });
}

export function policiesTree(): SiteNode {
  return makeNode({
    slug: "policies",
    title: "Policies",
    children: [
      makeNode({
        slug: "custodian-board-pol",
        title: "Custodian Board",
        metadata: { level: "group" },
        children: [
          makeNode({
            slug: "custodian-bylaws",
            title: "Custodian Board Bylaws",
            metadata: { level: "category", description: "Binding rules for the Custodian Board." },
          }),
          makeNode({
            slug: "custodian-guidelines",
            title: "Custodian Board Guidelines",
            metadata: { level: "category", description: "Non-binding guidance for custodians." },
          }),
        ],
      }),
      makeNode({
        slug: "volunteers-pol",
        title: "Volunteers",
        metadata: { level: "group" },
        children: [
          makeNode({
            slug: "volunteer-bylaws",
            title: "Volunteer Bylaws",
            metadata: { level: "category", description: "Binding rules for volunteers." },
          }),
        ],
      }),
    ],
  });
}

export function proceduresTree(): SiteNode {
  const t = policiesTree();
  return {
    ...t,
    slug: "procedures",
    title: "Procedures",
  };
}

export function roadmapTree(): SiteNode {
  return makeNode({
    slug: "roadmap",
    title: "Web App Development Roadmap",
    children: [
      makeNode({
        slug: "now",
        title: "Now",
        metadata: { level: "group" },
        children: [
          makeNode({
            slug: "kanecta-cutover",
            title: "Kanecta backend cutover",
            metadata: { level: "category", description: "Move all reads and writes onto the Kanecta datastore." },
          }),
        ],
      }),
      makeNode({
        slug: "next",
        title: "Next",
        metadata: { level: "group" },
        children: [
          makeNode({
            slug: "offline-support",
            title: "Offline support",
            metadata: { level: "category", description: "Service-worker caching for rural connectivity." },
          }),
        ],
      }),
    ],
  });
}
