import PageLayout from "../components/PageLayout";
import { NavCard } from "../components/NavCard";

const groups = [
  { title: "Resilience Hui", blurb: "The community resilience plan — workstreams, survey results, and local action.", path: "/groups/resilience" },
];

export default function Groups() {
  return (
    <PageLayout pageName="Groups & Organisations" showComingSoon={false}>
      <nav className="nav-grid">
        {groups.map((g) => <NavCard key={g.path} {...g} />)}
      </nav>
    </PageLayout>
  );
}
