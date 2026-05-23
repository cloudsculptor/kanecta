import Header from "../components/Header";
import Footer from "../components/Footer";
import { NavCard, ComingCard } from "../components/NavCard";
import ContributeForm from "../components/ContributeForm";
import WelcomeBanner from "../components/WelcomeBanner";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import keycloak from "../auth/keycloak";
import { usePageMeta } from "../hooks/usePageMeta";

const publicActive = [
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
    title: "Local Businesses",
    blurb: "Support and explore local businesses in Featherston and the South Wairarapa.",
    path: "/local-businesses",
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
    title: "Social Services",
    blurb: "Access social support, welfare, and community care services.",
    path: "/social-services",
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
    title: "Local Government",
    blurb: "Local and regional government services for Featherston.",
    path: "/local-government",
  },
];

const publicComing = [  
  {
    title: "Community Notice Board",
    blurb: "Community announcements, lost & found, and local news.",
  },
  {
    title: "Buy, Sell & Swap",
    blurb: "Buy, sell, swap, or give away items locally.",
  },  
];

export default function Home() {
  usePageMeta("Featherston", "Community information and connection for the town of Featherston, New Zealand — events, organisations, skills, transport, resilience and more.");
  const roles = useUserRoles();
  const isTeam = hasRole(roles, "team");
  const isModerator = hasRole(roles, "moderator");
  const { authenticated } = useKeycloak();
  const emailVerified = keycloak.tokenParsed?.email_verified === true;

  return (
    <>
      <Header />
      <nav className="nav-grid">
        {!authenticated && <WelcomeBanner />}
        {isTeam && (
          <>
            <div className="nav-divider">
              <span>Visible to team members only</span>
            </div>
            <NavCard
              accent
              title="Discussions"
              blurb="Share ideas, ask questions, and connect with others in the Featherston community."
              path="/discussions"
              image="/discussions-160x160.png"
              attribution={{
                label: "Photo: Canva AI",
                url: "https://www.canva.com/",
              }}
            />
            {isModerator && (
              <NavCard
                accent
                title="Approvals"
                blurb="Review and approve community-submitted events and suggestions"
                path="/governance/approvals"
              />
            )}
            <div className="nav-divider">
              <span>Visible to the public</span>
            </div>
          </>
        )}
        {publicActive.map((item) => <NavCard key={item.title} {...item} />)}
        <div className="nav-divider">
          <span>Ideas for the future</span>
        </div>
        {publicComing.map((item) => <ComingCard key={item.title} {...item} />)}
        <div className="nav-divider">
          <span>About this site</span>
        </div>
        <NavCard
          title="About this site"
          blurb="Our kaupapa, open governance, and how this site works."
          path="/about"
        />
        <NavCard
          title="Open governance"
          blurb="Documents and tools related to managing this site"
          path="/governance"
          image="/group-photo-160x160.png"
          attribution={{
            label: "Photo: Canva AI",
            url: "https://www.canva.com/",
          }}
        />
      </nav>
      <div className="nav-divider nav-divider--section"><span>Contribute to this site</span></div>
      <ContributeForm authenticated={authenticated} emailVerified={emailVerified} />
      <Footer />
    </>
  );
}
