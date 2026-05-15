import PageLayout from "../components/PageLayout";
import html from "../../../community-hub-governance/procedures/statutory-compliance.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureStatutoryCompliance() {
  return (
    <PageLayout pageName="Statutory Compliance" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
