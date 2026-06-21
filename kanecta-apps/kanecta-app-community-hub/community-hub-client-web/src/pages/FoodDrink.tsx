import PageLayout from "../components/PageLayout";
import SiteEditablePage from "../components/SiteEditablePage";

export default function FoodDrink() {
  return (
    <PageLayout pageName="Food & Drink" showComingSoon={false} showHeading={false}>
      <SiteEditablePage slug="food-drink" title="Food & Drink">
        <p>Cafes, restaurants, local producers, and farmers markets.</p>
      </SiteEditablePage>
    </PageLayout>
  );
}
