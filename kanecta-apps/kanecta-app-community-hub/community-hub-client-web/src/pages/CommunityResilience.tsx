import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

export default function CommunityResilience() {
  return (
    <PageLayout pageName="Community Resilience" showComingSoon={false}>
      <p>
        Featherston has faced its share of disruptions — the Remutaka Hill road closing due to slips
        or extreme weather, flooding, power outages, and the broader challenges that affect us all:
        recessions, supply chain shocks, oil price spikes, pandemics, and the growing impacts of
        climate change. When things get hard, communities that are connected, informed, and prepared
        fare far better than those that aren't.
      </p>
      <p>
        This page brings together the resources and people on this site that are most relevant to
        community resilience — from official services and local government through to the networks
        and groups actively working to strengthen Featherston's capacity to look after itself.
      </p>

      <h3>Official Services &amp; Support</h3>
      <ul>
        <li>
          <Link to="/local-government">Local Government</Link>
          {" "}— South Wairarapa District Council, civil defence, emergency management, and healthy homes support
        </li>
        <li>
          <Link to="/social-services">Social Services</Link>
          {" "}— food support, welfare, and community care services for when people need a hand
        </li>
      </ul>

      <h3>Community Networks</h3>
      <ul>
        <li>
          <Link to="/groups">Community Groups</Link>
          {" "}— local organisations, clubs, and groups that form the backbone of community life
        </li>
        <li>
          <Link to="/communication-networks">Communication Networks</Link>
          {" "}— local channels and networks for staying informed and connected, especially when normal communications are disrupted
        </li>
      </ul>

      <h3>Resilience Working Group</h3>
      <p>
        A group of Featherston citizens who are taking a deeper look at what community resilience
        means for our town — researching risks, identifying gaps, and developing practical resources.
      </p>
      <ul>
        <li>
          <Link to="/resilience/pages/about">Resilience Group</Link>
          {" "}— working documents, research, and resources developed by the group
        </li>
      </ul>
    </PageLayout>
  );
}
