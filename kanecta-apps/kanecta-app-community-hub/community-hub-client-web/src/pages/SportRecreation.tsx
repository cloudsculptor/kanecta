import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function SportRecreation() {
  return (
    <PageLayout pageName="Sport & Recreation" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="sport-recreation" title="Sport & Recreation">
        <p>Sports clubs, facilities, courts, and fitness groups.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
