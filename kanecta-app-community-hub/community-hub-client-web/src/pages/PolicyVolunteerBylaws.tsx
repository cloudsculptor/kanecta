import PageLayout from "../components/PageLayout";
import policyHtml from "../../../community-hub-governance/policies/volunteer-bylaws.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Policies", path: "/governance/policies" },
];

export default function PolicyVolunteerBylaws() {
  return (
    <PageLayout pageName="Volunteer Bylaws" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: policyHtml }} />
    </PageLayout>
  );
}
