import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function LocalAccommodation() {
  return (
    <PageLayout pageName="Local Accommodation" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="local-accommodation" title="Local Accommodation">
        <p>Places to stay in and around Featherston.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
