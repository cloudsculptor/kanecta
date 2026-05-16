import PageLayout from "../components/PageLayout";
import { NavCard } from "../components/NavCard";

export default function ResilienceGroup() {
  return (
    <PageLayout
      pageName="Resilience Hui"
      showComingSoon={false}
      parents={[{ name: "Groups", path: "/groups" }]}
    >
      <nav className="nav-grid">
        <NavCard
          featured
          title="Pages"
          blurb="Create and share pages with the team — documents, guides, and resources for the Featherston community."
          path="/pages"
        />
      </nav>
    </PageLayout>
  );
}
