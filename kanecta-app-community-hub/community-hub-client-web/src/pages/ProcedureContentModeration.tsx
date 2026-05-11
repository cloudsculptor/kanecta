import PageLayout from "../components/PageLayout";
import html from "../../../community-hub-governance/procedures/content-moderation.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureContentModeration() {
  return (
    <PageLayout pageName="Content Moderation" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
