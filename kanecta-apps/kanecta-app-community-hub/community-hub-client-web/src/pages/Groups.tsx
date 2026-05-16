import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { NavCard } from "../components/NavCard";

const groups = [
  { title: "Resilience", blurb: "The community resilience plan — workstreams, survey results, and local action.", path: "/groups/resilience" },
];

export default function Groups() {
  return (
    <>
      <Header />
      <Breadcrumb pageName="Groups" />
      <nav className="nav-grid">
        {groups.map((g) => <NavCard key={g.path} {...g} />)}
      </nav>
      <Footer />
    </>
  );
}
