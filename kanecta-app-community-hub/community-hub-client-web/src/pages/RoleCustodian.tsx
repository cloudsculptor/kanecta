import PageLayout from "../components/PageLayout";
import roleHtml from "../../../featherston-governance/roles/custodian.adoc";

const GOVERNANCE_PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Roles", path: "/governance/roles" },
];

export default function RoleCustodian() {
  return (
    <PageLayout pageName="Custodian" showComingSoon={false} parents={GOVERNANCE_PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: roleHtml }} />
    </PageLayout>
  );
}
