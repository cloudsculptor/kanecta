import PageLayout from "../components/PageLayout";
import policyHtml from "../../../community-hub-governance/policies/custodian-bylaws.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Policies", path: "/governance/policies" },
];

export default function PolicyCustodianBylaws() {
  return (
    <PageLayout pageName="Custodian Board Bylaws" showComingSoon={false} wip parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: policyHtml }} />
    </PageLayout>
  );
}
