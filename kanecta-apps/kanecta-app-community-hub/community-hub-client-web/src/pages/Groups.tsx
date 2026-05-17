import Header from "../components/Header";
import Breadcrumb from "../components/Breadcrumb";
import Footer from "../components/Footer";
import { NavCard } from "../components/NavCard";
import CC0Notice from "../components/CC0Notice";

const groups = [
  {
    title: "Resilience",
    blurb: "Local group developing a community resilience plan.",
    path: "/groups/resilience",
    image: "/resiliance-group-160x160.png",
    attribution: { label: "Photo: Canva AI", url: "https://www.canva.com/" },
  },
];

export default function Groups() {
  return (
    <>
      <Header />
      <Breadcrumb pageName="Groups" />
      <nav className="nav-grid">
        {groups.map((g) => <NavCard key={g.path} {...g} />)}
      </nav>
      <main className="page-content">
        <CC0Notice />
      </main>
      <Footer />
    </>
  );
}
