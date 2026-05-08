import PageLayout from "../components/PageLayout";
import html from "../../../featherston-governance/procedures/volunteer-onboarding.adoc";

const PARENTS = [
  { name: "Governance", path: "/governance" },
  { name: "Procedures", path: "/governance/procedures" },
];

export default function ProcedureVolunteerOnboarding() {
  return (
    <PageLayout pageName="Volunteer Onboarding" showComingSoon={false} parents={PARENTS}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: html }} />
    </PageLayout>
  );
}
