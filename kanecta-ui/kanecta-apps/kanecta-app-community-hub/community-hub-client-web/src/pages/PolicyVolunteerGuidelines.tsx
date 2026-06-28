import PageLayout from "../components/PageLayout";
import policyHtml from "../../../community-hub-governance/policies/volunteer-guidelines.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Policies", path: "/governance/policies" },
];

export default function PolicyVolunteerGuidelines() {
  return (
    <PageLayout pageName="Volunteer Guidelines" showComingSoon={false} wip parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: policyHtml }} />
    </PageLayout>
  );
}
