import PageLayout from "../components/PageLayout";
import policyHtml from "../../../community-hub-governance/policies/custodian-guidelines.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Policies", path: "/governance/policies" },
];

export default function PolicyCustodianGuidelines() {
  return (
    <PageLayout pageName="Custodian Board Guidelines" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: policyHtml }} />
    </PageLayout>
  );
}
