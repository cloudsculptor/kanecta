import PageLayout from "../components/PageLayout";
import html from "../../../featherston-governance/procedures/agm.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureAgm() {
  return (
    <PageLayout pageName="Annual General Meeting" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
