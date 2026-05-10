import PageLayout from "../components/PageLayout";

export default function Kai() {
  return (
    <PageLayout pageName="Kai" showComingSoon={false}>
      <h3>Food Support in Featherston</h3>
      <p>
        Resources for accessing kai and supporting food security in our
        community.
      </p>
      <ul>
        <li>
          <a href="https://fcc.nz/kai-food" target="_blank" rel="noopener noreferrer">
            Featherston Community Centre — Kai (Food)
          </a>{" "}
          — Pātaka Kai community pantry, Meals on Wheels, Foodbank, and the
          Wairarapa Fruit &amp; Vege Co-Op
        </li>
        <li>
          <a href="https://www.foodbank.co.nz/featherston-foodbank" target="_blank" rel="noopener noreferrer">
            Featherston Foodbank
          </a>{" "}
          — food parcels for South Wairarapa households, open Tuesdays &amp;
          Thursdays 1:30–2:30pm, no appointment needed
        </li>
      </ul>
    </PageLayout>
  );
}
