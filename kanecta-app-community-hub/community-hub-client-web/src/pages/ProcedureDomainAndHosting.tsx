import PageLayout from "../components/PageLayout";
import html from "../../../featherston-governance/procedures/domain-and-hosting.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureDomainAndHosting() {
  return (
    <PageLayout pageName="Domain and Hosting Management" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
