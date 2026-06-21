import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function PetsAnimals() {
  return (
    <PageLayout pageName="Pets & Animals" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="pets-animals" title="Pets & Animals">
        <p>Vets, lost pets, and animal services in the area.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
