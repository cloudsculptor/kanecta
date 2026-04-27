import PageLayout from "../components/PageLayout";

export default function Events() {
  return (
    <PageLayout pageName="Events" showComingSoon={false}>
      <h3>What's On in Featherston</h3>
      <p>
        Find local events, activities, and things to do in and around
        Featherston and the South Wairarapa.
      </p>
      <ul>
        <li>
          <a href="https://featherston.org.nz/events/" target="_blank" rel="noopener noreferrer">
            Featherston NZ — Events
          </a>{" "}
          — community-run listing of local events and activities
        </li>
        <li>
          <a href="https://www.eventfinda.co.nz/whatson/events/featherston" target="_blank" rel="noopener noreferrer">
            Eventfinda — Featherston
          </a>{" "}
          — searchable event listings for Featherston and the region
        </li>
        <li>
          <a href="https://www.waieventhub.co.nz/" target="_blank" rel="noopener noreferrer">
            Wairarapa Event Hub
          </a>{" "}
          — regional events aggregator covering the wider Wairarapa
        </li>
        <li>
          <a href="https://featherstoninfo.nz/" target="_blank" rel="noopener noreferrer">
            Featherston Info
          </a>{" "}
          — local information site with news and upcoming events
        </li>
      </ul>

      <h3>Annual Highlights</h3>
      <ul>
        <li>
          <a href="https://www.booktown.org.nz/" target="_blank" rel="noopener noreferrer">
            Featherston Booktown Karukatea Festival
          </a>{" "}
          — annual literary festival held each May, one of New Zealand's
          premier book events
        </li>
        <li>
          <a href="https://www.eventfinda.co.nz/whatson/events/featherston" target="_blank" rel="noopener noreferrer">
            Wairarapa Music in the Country
          </a>{" "}
          — three days of live music at Tauherenikau Racecourse each January
        </li>
      </ul>
    </PageLayout>
  );
}
