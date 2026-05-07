import PageLayout from "../components/PageLayout";
import roleHtml from "../../../featherston-governance/roles/volunteer.adoc";

const GOVERNANCE_PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Roles", path: "/governance/roles" },
];

export default function RoleVolunteer() {
  return (
    <PageLayout pageName="Volunteer" showComingSoon={false} parents={GOVERNANCE_PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: roleHtml }} />
    </PageLayout>
  );
}
