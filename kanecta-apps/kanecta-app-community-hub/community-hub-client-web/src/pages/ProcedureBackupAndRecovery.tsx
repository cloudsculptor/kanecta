import PageLayout from "../components/PageLayout";
import html from "../../../community-hub-governance/procedures/backup-and-recovery.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureBackupAndRecovery() {
  return (
    <PageLayout pageName="Backup and Recovery" showComingSoon={false} wip parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
