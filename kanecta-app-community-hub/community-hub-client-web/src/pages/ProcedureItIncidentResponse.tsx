import PageLayout from "../components/PageLayout";
import html from "../../../community-hub-governance/procedures/it-incident-response.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureItIncidentResponse() {
  return (
    <PageLayout pageName="IT Incident Response" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
