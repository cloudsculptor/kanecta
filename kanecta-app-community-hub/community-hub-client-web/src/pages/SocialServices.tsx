import PageLayout from "../components/PageLayout";

export default function SocialServices() {
  return (
    <PageLayout pageName="Social Services" showComingSoon={false}>
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
