import PageLayout from "../components/PageLayout";
import html from "../../../featherston-governance/procedures/financial-reporting.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureFinancialReporting() {
  return (
    <PageLayout pageName="Financial Reporting" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
