import PageLayout from "../components/PageLayout";
import html from "../../../community-hub-governance/procedures/domain-and-hosting.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureDomainAndHosting() {
  return (
    <PageLayout pageName="Domain and Hosting Management" showComingSoon={false} wip parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
