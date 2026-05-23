import PageLayout from "../components/PageLayout";

export default function LocalBusinesses() {
  return (
    <PageLayout pageName="Local Businesses" showComingSoon={false}>
      <h3>Local Businesses &amp; Services</h3>
      <p>
        Support and explore the local economy of Featherston and the South
        Wairarapa.
      </p>
      <ul>
        <li>
          <a href="https://featherstoninfo.nz/" target="_blank" rel="noopener noreferrer">
            Featherston Info
          </a>{" "}
          — directory of local businesses, accommodation, dining, shopping, and
          attractions in Featherston
        </li>
      </ul>
    </PageLayout>
  );
}
