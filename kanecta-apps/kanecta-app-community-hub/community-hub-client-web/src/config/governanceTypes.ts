export type GovSectionType = "procedure" | "policy" | "minutes" | "roadmap";

export const GOV_SECTION_CONFIG: Record<GovSectionType, {
  treeRoot: string;
  ownerTypePrefix: string;
  urlPrefix: string;
  label: string;
  govType: string;
}> = {
  procedure: {
    treeRoot: "procedures",
    ownerTypePrefix: "gov-proc",
    urlPrefix: "/governance/procedures",
    label: "Procedures",
    govType: "procedure",
  },
  policy: {
    treeRoot: "policies",
    ownerTypePrefix: "gov-pol",
    urlPrefix: "/governance/policies",
    label: "Policies",
    govType: "policy",
  },
  minutes: {
    treeRoot: "minutes",
    ownerTypePrefix: "min",
    urlPrefix: "/governance/minutes",
    label: "Meeting Minutes",
    govType: "minutes",
  },
  roadmap: {
    treeRoot: "roadmap",
    ownerTypePrefix: "road",
    urlPrefix: "/governance/roadmap",
    label: "Web App Development Roadmap",
    govType: "roadmap",
  },
};
