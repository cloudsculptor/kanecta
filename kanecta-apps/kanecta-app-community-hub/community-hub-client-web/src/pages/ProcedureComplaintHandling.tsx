import PageLayout from "../components/PageLayout";
import html from "../../../community-hub-governance/procedures/complaint-handling.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureComplaintHandling() {
  return (
    <PageLayout pageName="Complaint Handling" showComingSoon={false} wip parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
