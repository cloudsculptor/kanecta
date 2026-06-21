import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function JobsVolunteering() {
  return (
    <PageLayout pageName="Jobs & Volunteering" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="jobs-volunteering" title="Jobs & Volunteering">
        <p>Local employment opportunities and ways to contribute your skills.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
