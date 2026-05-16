import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const groups = [
  { title: "Kai", blurb: "Food, kai, and local produce from around Featherston.", path: "/kai" },
  { title: "Transport and Mobility", blurb: "Carpooling, ride sharing, and transport options in the area.", path: "/transport-and-mobility" },
  { title: "Skill Sharing", blurb: "Share your skills or find someone with the expertise you need.", path: "/skill-sharing" },
  { title: "Social Services", blurb: "Access social support, welfare, and community care services.", path: "/social-services" },
  { title: "Communication Networks", blurb: "Stay connected with local networks, groups, and channels.", path: "/communication-networks" },
  { title: "Local Economy", blurb: "Support and grow the local economy of Featherston.", path: "/local-economy" },
  { title: "Resilience", blurb: "The community resilience plan — workstreams, survey results, and local action.", path: "/resilience" },
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
