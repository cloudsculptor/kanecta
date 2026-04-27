import PageLayout from "../components/PageLayout";

export default function Transport() {
  return (
    <PageLayout pageName="Transport" showComingSoon={false}>
      <h3>Train</h3>
      <p>
        Featherston is served by the{" "}
        <a href="https://www.metlink.org.nz/service/WRL" target="_blank" rel="noopener noreferrer">
          Wairarapa Line
        </a>{" "}
        — a commuter rail service running between Masterton and Wellington. The
        journey to Wellington takes around one hour.
      </p>
      <ul>
        <li>
          <a href="https://www.metlink.org.nz/stop/FEAT" target="_blank" rel="noopener noreferrer">
            Live departures — Featherston Station
          </a>
        </li>
        <li>
          <a href="https://www.metlink.org.nz/service/WRL/timetable" target="_blank" rel="noopener noreferrer">
            Wairarapa Line timetable
          </a>
        </li>
      </ul>

      <h3>Bus</h3>
      <p>
        Route 200 connects Featherston with Masterton and Martinborough. Check
        the{" "}
        <a href="https://www.metlink.org.nz" target="_blank" rel="noopener noreferrer">
          Metlink website
        </a>{" "}
        for current timetables and stop information.
      </p>

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
