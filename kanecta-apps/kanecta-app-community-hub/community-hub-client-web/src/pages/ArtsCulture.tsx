import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function ArtsCulture() {
  return (
    <PageLayout pageName="Arts & Culture" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="arts-culture" title="Arts & Culture">
        <p>Local artists, galleries, Booktown festival, and performances.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
