import PageLayout from "../components/PageLayout";
import html from "../../../featherston-governance/procedures/complaint-handling.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureComplaintHandling() {
  return (
    <PageLayout pageName="Complaint Handling" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
