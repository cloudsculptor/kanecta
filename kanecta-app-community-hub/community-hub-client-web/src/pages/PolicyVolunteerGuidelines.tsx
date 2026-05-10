import PageLayout from "../components/PageLayout";
import policyHtml from "../../../featherston-governance/policies/volunteer-guidelines.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Policies", path: "/governance/policies" },
];

export default function PolicyVolunteerGuidelines() {
  return (
    <PageLayout pageName="Volunteer Guidelines" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: policyHtml }} />
    </PageLayout>
  );
}
