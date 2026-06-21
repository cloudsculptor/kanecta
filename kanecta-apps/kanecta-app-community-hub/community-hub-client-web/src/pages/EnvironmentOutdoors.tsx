import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function EnvironmentOutdoors() {
  return (
    <PageLayout pageName="Environment & Outdoors" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="environment-outdoors" title="Environment & Outdoors">
        <p>Remutaka Rail Trail, Lake Wairarapa, conservation, and local walks.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
