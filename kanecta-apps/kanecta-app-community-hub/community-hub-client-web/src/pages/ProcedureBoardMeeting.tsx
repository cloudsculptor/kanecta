import PageLayout from "../components/PageLayout";
import html from "../../../community-hub-governance/procedures/board-meeting.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureBoardMeeting() {
  return (
    <PageLayout pageName="Custodian Board Meeting" showComingSoon={false} wip parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
