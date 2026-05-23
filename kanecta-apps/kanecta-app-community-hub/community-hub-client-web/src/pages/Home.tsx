import Header from "../components/Header";
import Footer from "../components/Footer";
import { NavCard, ComingCard } from "../components/NavCard";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { usePageMeta } from "../hooks/usePageMeta";

const publicActive = [
  {
    title: "Local Businesses",
    blurb: "Support and explore local businesses in Featherston and the South Wairarapa.",
    path: "/local-businesses",
  },
  {
    title: "Events",
    blurb: "Find local events, gatherings, and activities happening in Featherston.",
    path: "/events",
    image: "/balloon-160x160.png",
    attribution: {
      label: "Photo: Bryan Kennedy / Public Domain",
      url: "https://commons.wikimedia.org/wiki/File:Balloon_free_image.jpg",
    },
  },
  {
    title: "Transport",
    blurb: "Public transport, carpooling, ride sharing, and transport options in the area.",
    path: "/transport",
    image: "/featherston-station-160x160.png",
    attribution: {
      label: "Photo: Sanciston / CC0",
      url: "https://commons.wikimedia.org/wiki/File:Featherston_station_2025.png",
    },
  },
  {
    title: "Community Groups",
    blurb: "Discover local community groups",
    path: "/groups",
    image: "/group-photo-160x160.png",
    attribution: {
      label: "Photo: Canva AI",
      url: "https://www.canva.com/",
    },
  },
  {
    title: "Communication Networks",
    blurb: "Stay connected with local networks, groups, and channels.",
    path: "/communication-networks",
    image: "/notice-boards-160x160.png",
    attribution: {
      label: "Photo: Joseph Barillari",
      url: "https://commons.wikimedia.org/wiki/File:Infinite-corridor-bboard.jpeg",
    },
  },
  {
    title: "Social Services",
    blurb: "Access social support, welfare, and community care services.",
    path: "/social-services",
  },
];

const publicComing = [  
  {
    title: "Buy, Sell & Swap",
    blurb: "Buy, sell, swap, or give away items locally.",
  },
  {
    title: "Notice Board",
    blurb: "Community announcements, lost & found, and local news.",
  },
];

const localItems = [
];


export default function Home() {
  usePageMeta("Featherston", "Community information and connection for the town of Featherston, New Zealand — events, organisations, skills, transport, resilience and more.");
  const roles = useUserRoles();
  const isTeam = hasRole(roles, "team");

  return (
    <>
      <Header />
      <nav className="nav-grid">
        {isTeam ? (
          <>
            <NavCard
              featured
              title="Discussions"
              blurb="Share ideas, ask questions, and connect with others in the Featherston community."
              path="/discussions"
              image="/discussions-160x160.png"
              attribution={{
                label: "Photo: Canva AI",
                url: "https://www.canva.com/",                
              }}
            />
            <NavCard
              accent
              title="Community Groups"
              blurb="Discover local community groups"
              path="/groups"
              image="/group-photo-160x160.png"
              attribution={{
                label: "Photo: Canva AI",
                url: "https://www.canva.com/",
              }}
            />
            {localItems.map((item) => <NavCard key={item.title} {...item} />)}
          </>
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
