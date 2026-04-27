import { Link } from "react-router-dom";
import Header from "../components/Header";
import { useUserRole } from "../auth/useUserRole";

const publicActive = [
  {
    title: "Events",
    blurb: "Find local events, gatherings, and activities happening in Featherston.",
    path: "/events",
  },
  {
    title: "Transport",
    blurb: "Carpooling, ride sharing, and transport options in the area.",
    path: "/transport",
  },
];

const publicComing = [
  {
    title: "Groups & Organisations",
    blurb: "Discover local community groups, and organisations near you.",
  },
  {
    title: "Goods & Services",
    blurb: "Buy, sell, swap, or give away goods and services locally.",
  },
  {
    title: "Social Services",
    blurb: "Access social support, welfare, and community care services.",
  },
  {
    title: "About this site",
    blurb: "Learn how this site works and how to get involved.",
  },
];

const localItems = [
  {
    title: "Kai",
    blurb: "Food, kai, and local produce from around Featherston.",
    path: "/kai",
  },
  {
    title: "Events",
    blurb: "Find local events, gatherings, and activities happening in Featherston.",
    path: "/events",
  },
  {
    title: "Transport and Mobility",
    blurb: "Carpooling, ride sharing, and transport options in the area.",
    path: "/transport-and-mobility",
  },
  {
    title: "Skill Sharing",
    blurb: "Share your skills or find someone with the expertise you need.",
    path: "/skill-sharing",
  },
  {
    title: "Social Services",
    blurb: "Access social support, welfare, and community care services.",
    path: "/social-services",
  },
  {
    title: "Communication Networks",
    blurb: "Stay connected with local networks, groups, and channels.",
    path: "/communication-networks",
  },
  {
    title: "Local Economy",
    blurb: "Support and grow the local economy of Featherston.",
    path: "/local-economy",
  },
  {
    title: "About this site",
    blurb: "Learn how this site works and how to get involved.",
    path: "/about",
  },
];

function NavCard({ title, blurb, path }: { title: string; blurb: string; path: string }) {
  return (
    <Link to={path} className="nav-card">
      <div className="nav-card__image" />
      <div className="nav-card__content">
        <h2 className="nav-card__title">{title}</h2>
        <p className="nav-card__blurb">{blurb}</p>
      </div>
    </Link>
  );
}

function ComingCard({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="nav-card nav-card--coming">
      <div className="nav-card__image" />
      <div className="nav-card__content">
        <h2 className="nav-card__title">{title}</h2>
        <p className="nav-card__blurb">{blurb}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const role = useUserRole();
  const isLocal = role !== "PUBLIC";

  return (
    <>
      <Header />
      <nav className="nav-grid">
        {isLocal ? (
          localItems.map((item) => <NavCard key={item.title} {...item} />)
        ) : (
          <>
            {publicActive.map((item) => <NavCard key={item.title} {...item} />)}
            <div className="nav-divider">
              <span>Ideas for the future</span>
            </div>
            {publicComing.map((item) => <ComingCard key={item.title} {...item} />)}
          </>
        )}
      </nav>
    </>
  );
}
