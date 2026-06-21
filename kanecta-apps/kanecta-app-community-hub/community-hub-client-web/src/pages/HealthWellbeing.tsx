import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function HealthWellbeing() {
  return (
    <PageLayout pageName="Health & Wellbeing" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="health-wellbeing" title="Health & Wellbeing">
        <p>GPs, pharmacy, dentist, mental health, and healthcare access in Featherston.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
