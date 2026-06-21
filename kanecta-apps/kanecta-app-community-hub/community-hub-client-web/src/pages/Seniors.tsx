import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function Seniors() {
  return (
    <PageLayout pageName="Seniors" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="seniors" title="Seniors">
        <p>Services, activities, and support for older residents.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
