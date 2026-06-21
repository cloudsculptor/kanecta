import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function History() {
  return (
    <PageLayout pageName="History" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="history" title="History">
        <p>The history of Featherston and the surrounding district.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
