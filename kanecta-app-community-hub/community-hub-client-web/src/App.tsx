import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Events from "./pages/Events";
import Skills from "./pages/Skills";
import Transport from "./pages/Transport";
import Needs from "./pages/Needs";
import Organisations from "./pages/Organisations";
import GoodsAndServices from "./pages/GoodsAndServices";
import SocialServices from "./pages/SocialServices";
import AboutThisSite from "./pages/AboutThisSite";
import Governance from "./pages/Governance";
import Resilience from "./pages/Resilience";
import Kai from "./pages/Kai";
import TransportAndMobility from "./pages/TransportAndMobility";
import SkillSharing from "./pages/SkillSharing";
import CommunicationNetworks from "./pages/CommunicationNetworks";
import LocalEconomy from "./pages/LocalEconomy";
import Discussions from "./pages/Discussions";
import TeamRequired from "./pages/TeamRequired";
import Roadmap from "./pages/Roadmap";
import Constitution from "./pages/Constitution";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/events" element={<Events />} />
      <Route path="/skills" element={<Skills />} />
      <Route path="/transport" element={<Transport />} />
      <Route path="/needs" element={<Needs />} />
      <Route path="/organisations" element={<Organisations />} />
      <Route path="/goods-and-services" element={<GoodsAndServices />} />
      <Route path="/social-services" element={<SocialServices />} />
      <Route path="/about" element={<AboutThisSite />} />
      <Route path="/about/governance" element={<Governance />} />
      <Route path="/resilience" element={<Resilience />} />
      <Route path="/kai" element={<Kai />} />
      <Route path="/transport-and-mobility" element={<TransportAndMobility />} />
      <Route path="/skill-sharing" element={<SkillSharing />} />
      <Route path="/communication-networks" element={<CommunicationNetworks />} />
      <Route path="/local-economy" element={<LocalEconomy />} />
      <Route path="/discussions" element={<Discussions />} />
      <Route path="/discussions/team-required" element={<TeamRequired />} />
      <Route path="/roadmap" element={<Roadmap />} />
      <Route path="/constitution" element={<Constitution />} />
    </Routes>
  );
}
