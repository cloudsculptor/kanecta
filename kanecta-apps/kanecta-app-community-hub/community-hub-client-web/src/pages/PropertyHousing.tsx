import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function PropertyHousing() {
  return (
    <PageLayout pageName="Property & Housing" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="property-housing" title="Property & Housing">
        <p>Rentals, real estate, and local housing information.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
