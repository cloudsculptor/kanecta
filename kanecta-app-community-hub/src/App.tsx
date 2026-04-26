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
    </Routes>
  );
}
