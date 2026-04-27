import { Link } from "react-router-dom";
import Tooltip from "@mui/material/Tooltip";
import Header from "../components/Header";
import Footer from "../components/Footer";
import { useUserRole } from "../auth/useUserRole";

const publicActive = [
  {
    title: "Events",
    blurb: "Find local events, gatherings, and activities happening in Featherston.",
    path: "/events",
    image: "/events-balloon.jpg",
    attribution: {
      label: "Photo: Bryan Kennedy / Public Domain",
      url: "https://commons.wikimedia.org/wiki/File:Balloon_free_image.jpg",
    },
  },
  {
    title: "Transport",
    blurb: "Carpooling, ride sharing, and transport options in the area.",
    path: "/transport",
    image: "/featherston-station.jpg",
    attribution: {
      label: "Photo: Sanciston / CC0",
      url: "https://commons.wikimedia.org/wiki/File:Featherston_station_2025.png",
    },
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

interface Attribution {
  label: string;
  url: string;
}

function NavCard({
  title,
  blurb,
  path,
  image,
  attribution,
}: {
  title: string;
  blurb: string;
  path: string;
  image?: string;
  attribution?: Attribution;
}) {
  return (
    <Link to={path} className="nav-card">
      <Tooltip
        title={
          attribution ? (
            <a
              href={attribution.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: "inherit", textDecoration: "underline" }}
            >
              {attribution.label}
            </a>
          ) : ""
        }
        enterDelay={1500}
        enterNextDelay={1500}
        disableHoverListener={!attribution}
      >
        <div
          className="nav-card__image"
          style={
            image
              ? { backgroundImage: `url(${image})`, backgroundSize: "cover", backgroundPosition: "center" }
              : undefined
          }
        />
      </Tooltip>
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
      <Footer />
    </>
  );
}
