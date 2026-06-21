import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function VisitorActivities() {
  return (
    <PageLayout pageName="Visitor Activities" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="visitor-activities" title="Visitor Activities">
        <p>Things to do and see in Featherston and the South Wairarapa.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
