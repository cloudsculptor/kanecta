import PageLayout from "../components/PageLayout";

export default function TransportAndMobility() {
  return (
    <PageLayout pageName="Transport and Mobility" showComingSoon={false}>
      <h3>Train</h3>
      <p>
        Featherston is served by the Wairarapa Line — a commuter rail service
        running between Masterton and Wellington, taking around one hour to the
        city.
      </p>
      <ul>
        <li>
          <a href="https://www.metlink.org.nz/service/WRL/timetable" target="_blank" rel="noopener noreferrer">
            Wairarapa Line timetable
          </a>
        </li>
      </ul>

      <h3>Bus</h3>
      <ul>
        <li>
          <a href="https://www.metlink.org.nz/service/200/timetable" target="_blank" rel="noopener noreferrer">
            Route 200 timetable
          </a>{" "}
          — connects Featherston with Masterton and Martinborough
        </li>
      </ul>

      <h3>Carpooling &amp; Rideshare</h3>
      <ul>
        <li>
          <a href="https://www.facebook.com/groups/1959020375004132" target="_blank" rel="noopener noreferrer">
            Featherston Ride Sharers
          </a>{" "}
          — local Facebook group for sharing rides to and from Featherston
        </li>
      </ul>
    </PageLayout>
  );
}
