import PageLayout from "../components/PageLayout";

export default function LocalGovernment() {
  return (
    <PageLayout pageName="Local Government" showComingSoon={false}>
      <h3>South Wairarapa District Council</h3>
      <p>
        The South Wairarapa District Council (SWDC) is the local authority for Featherston
        and the wider South Wairarapa district.
      </p>
      <ul>
        <li>
          <a href="https://swdc.govt.nz/" target="_blank" rel="noopener noreferrer">
            South Wairarapa District Council — website
          </a>{" "}
          — council services, planning, rates, rubbish &amp; recycling, and more
        </li>
        <li>
          <a href="https://www.facebook.com/SouthWairarapaDistrictCouncil" target="_blank" rel="noopener noreferrer">
            South Wairarapa District Council — Facebook
          </a>{" "}
          — news and updates from the council
        </li>
      </ul>

      <h3>Featherston Community Board</h3>
      <p>
        The Featherston Community Board is an elected body that represents the interests of
        the Featherston community within the SWDC.
      </p>
      <ul>
        <li>
          <a href="https://www.facebook.com/FeatherstonCommunityBoard" target="_blank" rel="noopener noreferrer">
            Featherston Community Board — Facebook
          </a>{" "}
          — updates and engagement from your local community board
        </li>
      </ul>

      <h3>Greater Wellington Regional Council</h3>
      <p>
        The Greater Wellington Regional Council (GWRC) looks after the region's environment,
        public transport, and water supply, covering Featherston and the wider Wellington region.
      </p>
      <ul>
        <li>
          <a href="https://www.gw.govt.nz/" target="_blank" rel="noopener noreferrer">
            Greater Wellington Regional Council — website
          </a>{" "}
          — environment, parks, flood protection, public transport, and regional planning
        </li>
      </ul>

      <h3>Civil Defence &amp; Emergency Management</h3>
      <p>
        The Wellington Region Emergency Management Office (WREMO) coordinates civil defence
        and emergency preparedness across the region, including Featherston.
      </p>
      <ul>
        <li>
          <a href="https://swdc.govt.nz/services/civil-defence/" target="_blank" rel="noopener noreferrer">
            SWDC — Civil Defence
          </a>{" "}
          — local civil defence information and emergency contacts
        </li>
        <li>
          <a href="https://www.wremo.nz/get-ready/community-ready/community-emergency-hubs" target="_blank" rel="noopener noreferrer">
            Community Emergency Hubs — WREMO
          </a>{" "}
          — local emergency hubs where your neighbourhood can gather, share resources, and
          self-organise after a major event
        </li>
      </ul>

      <h3>Healthy Homes</h3>
      <p>
        Insulation, heating, and keeping warm — support for South Wairarapa households.
      </p>
      <ul>
        <li>
          <a href="https://swdc.govt.nz/healthy-homes/" target="_blank" rel="noopener noreferrer">
            SWDC — Healthy Homes
          </a>{" "}
          — information on insulation subsidies, heating assistance, and warmer homes support
        </li>
      </ul>
    </PageLayout>
  );
}
