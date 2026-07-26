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
    image: "/home-page-images/events-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Transport",
    blurb: "Public transport, carpooling, ride sharing, and transport options in the area.",
    path: "/transport",
    image: "/home-page-images/featherston-station-160x160.png",
    attribution: {
      label: "Photo: Sanciston / CC0",
      url: "https://commons.wikimedia.org/wiki/File:Featherston_station_2025.png",
    },
  },
  {
    title: "Community Notice Board",
    blurb: "Community announcements, lost & found, and local news.",
    path: "/notice-board",
    image: "/home-page-images/notice-board-160x160.jpg",
  },
  {
    title: "Community Groups",
    blurb: "Discover local community groups",
    path: "/groups",
    image: "/home-page-images/community-groups-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Local Businesses",
    blurb: "Support and explore local businesses in Featherston and the South Wairarapa.",
    path: "/local-businesses",
    image: "/home-page-images/local-business-160x160.jpg",
    attribution: { label: "Photo: Richard Thomas" },
  },
  {
    title: "Social Services",
    blurb: "Access social support, welfare, and community care services.",
    path: "/social-services",
    image: "/home-page-images/social-services-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Community Resilience",
    blurb: "Resources and networks for when things get tough.",
    path: "/community-resilience",
    image: "/home-page-images/resilience-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Communication Networks",
    blurb: "Stay connected with local networks, groups, and channels.",
    path: "/communication-networks",
    image: "/home-page-images/comm-networks-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Local Government",
    blurb: "Local and regional government services for Featherston.",
    path: "/local-government",
    image: "/home-page-images/local-government-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Education",
    blurb: "Schools, early childhood services, and learning resources in Featherston.",
    path: "/education",
    image: "/home-page-images/education-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
];

const publicComing = [
  {
    title: "Buy, Sell & Swap",
    blurb: "Buy, sell, swap, or give away items locally.",
    image: "/home-page-images/buy-sell-and-swap-160x160.jpg",
    attribution: {
      label: "Photo: Gemini AI",
      url: "https://gemini.google.com/",
    },
  },
  {
    title: "Visitor Activities",
    blurb: "Things to do and see in Featherston and the South Wairarapa.",
    image: "/home-page-images/visitor-activities-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Health & Wellbeing",
    blurb: "GPs, pharmacy, dentist, mental health, and healthcare access in Featherston.",
    image: "/home-page-images/health-and-wellbeing-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Sport & Recreation",
    blurb: "Sports clubs, facilities, courts, and fitness groups.",
    image: "/home-page-images/sports-and-rec-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Environment & Outdoors",
    blurb: "Remutaka Rail Trail, Lake Wairarapa, conservation, and local walks.",
    image: "/home-page-images/outdoors-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Arts & Culture",
    blurb: "Local artists, galleries, Booktown festival, and performances.",
    image: "/home-page-images/arts-and-culture-160x160.jpg",
    attribution: {
      label: "Photo: PhillipC / CC BY 2.0",
      url: "https://www.flickr.com/photos/42033648@N00/323749552",
    },
  },
  {
    title: "Food & Drink",
    blurb: "Cafes, restaurants, local producers, and farmers markets.",
    image: "/home-page-images/food-and-drink-160x160.jpg",
    attribution: {
      label: "Photo: Gemini AI",
      url: "https://gemini.google.com/",
    },
  },
  {
    title: "Jobs & Volunteering",
    blurb: "Local employment opportunities and ways to contribute your skills.",
    image: "/home-page-images/jobs-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Property & Housing",
    blurb: "Rentals, real estate, and local housing information.",
    image: "/home-page-images/housing-160x160.jpg",
    attribution: {
      label: "Photo: Pakoire / CC0",
      url: "https://commons.wikimedia.org/wiki/File:FthstnB_05.jpg",
    },
  },
  {
    title: "Youth",
    blurb: "Services, activities, and resources for young people in Featherston.",
    image: "/home-page-images/youth-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Seniors",
    blurb: "Services, activities, and support for older residents.",
    image: "/home-page-images/seniors-160x160.jpg",
    attribution: { label: "Photo: Joanna Baldwin" },
  },
  {
    title: "Pets & Animals",
    blurb: "Vets, lost pets, and animal services in the area.",
    image: "/home-page-images/pets-and-animals-160x160.jpg",
    attribution: { label: "Photo: Sam Bartlett at Orton Lodge" },
  },
  {
    title: "Local Accommodation",
    blurb: "Places to stay in and around Featherston.",
    image: "/home-page-images/local-accommodation-160x160.jpg",
    attribution: {
      label: "Photo: Pakoire / CC BY-SA 3.0",
      url: "https://commons.wikimedia.org/wiki/File:The_Royal_Hotel.jpg",
    },
  },
  {
    title: "History",
    blurb: "The history of Featherston and the surrounding district.",
    image: "/home-page-images/history-160x160.jpg",
    attribution: {
      label: "Photo: Muir & Moodie / Te Papa (no known copyright restrictions)",
      url: "https://collections.tepapa.govt.nz/object/320286",
    },
  },
];

export default function Home() {
  usePageMeta("Featherston", "Community information and connection for the town of Featherston, New Zealand — events, organisations, skills, transport, resilience and more.");
  const roles = useUserRoles();
  const isTeam = hasRole(roles, "team");
  const isModerator = hasRole(roles, "moderator");
  const { authenticated } = useKeycloak();
  const emailVerified = keycloak.tokenParsed?.email_verified === true;
  const isGuest = authenticated && roles.length === 0;

  return (
    <>
      <Header />
      {isGuest && (
        <div className="guest-banner">
          <strong>Welcome!</strong> Your membership request has been submitted and one of our moderators will approve it soon.
          In the meantime you can submit feedback, post events, and post community notices.
          Once approved, you'll get access to the community discussion threads.
          If you don't hear back shortly, contact us at{" "}
          <a href="mailto:hello@featherston.co.nz">hello@featherston.co.nz</a>.
        </div>
      )}
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
              image="/home-page-images/discussions-160x160.png"
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
                image="/home-page-images/approve-160x160.jpg"
                path="/approvals"
                attribution={{
                  label: "Photo: Canva AI",
                  url: "https://www.canva.com/",
                }}
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
          image="/home-page-images/about-this-site-160x160.jpg"
          path="/about"
          attribution={{
            label: "Photo: Deano87 / CC BY-SA 3.0",
            url: "https://commons.wikimedia.org/wiki/File:State_Highway_2_%28Rimutaka_Hill_Road%29_near_the_top_of_the_range..jpg",
          }}
        />
        <NavCard
          title="Open governance"
          blurb="Documents and tools related to managing this site"
          path="/governance"
          image="/home-page-images/group-photo-160x160.png"
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
