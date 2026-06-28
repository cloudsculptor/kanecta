import PageLayout from "../components/PageLayout";

export default function SocialServices() {
  return (
    <PageLayout pageName="Social Services" showComingSoon={false}>
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

      <h3>Find Support</h3>
      <p>
        Directories and resources to help connect you with social support
        services in Featherston and the wider Wairarapa.
      </p>
      <ul>
        <li>
          <a href="https://waisct.org.nz/directory/" target="_blank" rel="noopener noreferrer">
            Wairarapa Services Directory
          </a>{" "}
          — comprehensive local directory of community, health, education, and
          youth services across the Wairarapa, maintained by the Wairarapa
          Safer Community Trust
        </li>
        <li>
          <a href="https://www.familyservices.govt.nz/directory/" target="_blank" rel="noopener noreferrer">
            Family Services Directory
          </a>{" "}
          — Ministry of Social Development's national directory for finding
          family support, financial assistance, housing, and more
        </li>
        <li>
          <a href="https://swdc.govt.nz/community/community-organisations/" target="_blank" rel="noopener noreferrer">
            South Wairarapa District Council — Community Organisations
          </a>{" "}
          — local community groups and organisations in the South Wairarapa
        </li>
      </ul>
    </PageLayout>
  );
}
