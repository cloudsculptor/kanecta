import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function Youth() {
  return (
    <PageLayout pageName="Youth" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="youth" title="Youth">
        <p>Services, activities, and resources for young people in Featherston.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
