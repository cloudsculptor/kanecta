import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const groups = [
  { title: "Resilience Hui", blurb: "The community resilience plan — workstreams, survey results, and local action.", path: "/resilience" },
];

export default function Groups() {
  return (
    <PageLayout pageName="Groups" showComingSoon={false}>
      <div className="gov-links">
        {groups.map(({ title, blurb, path }) => (
          <Link key={path} to={path} className="gov-links__item">
            <span className="gov-links__title">{title}</span>
            <span className="gov-links__desc">{blurb}</span>
            <span className="gov-links__arrow">→</span>
          </Link>
        ))}
      </div>
    </PageLayout>
  );
}
