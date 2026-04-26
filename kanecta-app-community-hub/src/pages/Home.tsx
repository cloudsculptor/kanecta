import { Link } from "react-router-dom";
import Header from "../components/Header";

const navItems = [
  {
    title: "Events",
    blurb:
      "Find local events, gatherings, and activities happening in Featherston.",
    path: "/events",
  },
  {
    title: "Skills",
    blurb: "Share your skills or find someone with the expertise you need.",
    path: "/skills",
  },
  {
    title: "Transport",
    blurb: "Carpooling, ride sharing, and transport options in the area.",
    path: "/transport",
  },
  {
    title: "Needs",
    blurb: "Post or browse community needs and requests for help.",
    path: "/needs",
  },
  {
    title: "Groups & Organisations",
    blurb: "Discover local community groups, and organisations near you.",
    path: "/organisations",
  },
  {
    title: "Goods & Services",
    blurb: "Buy, sell, swap, or give away goods and services locally.",
    path: "/goods-and-services",
  },
  {
    title: "Social Services",
    blurb: "Access social support, welfare, and community care services.",
    path: "/social-services",
  },
  {
    title: "About this site",
    blurb: "Learn how this site works and how to get involved.",
    path: "/about",
  },
];

export default function Home() {
  return (
    <>
      <Header />
      <nav className="nav-grid">
        {navItems.map((item) => (
          <Link key={item.title} to={item.path} className="nav-card">
            <div className="nav-card__image" />
            <div className="nav-card__content">
              <h2 className="nav-card__title">{item.title}</h2>
              <p className="nav-card__blurb">{item.blurb}</p>
            </div>
          </Link>
        ))}
      </nav>
    </>
  );
}
