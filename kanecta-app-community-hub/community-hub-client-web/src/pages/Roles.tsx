import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const roles = [
  { title: "Custodian", path: "/governance/roles/custodian", description: "The sortition-selected oversight body. Protects the community's interests without directing day-to-day work." },
  { title: "Meeting Facilitator (Chairperson)", path: "/governance/roles/chairperson", description: "A rotating role appointed by the Board at the start of each meeting. No casting vote, no permanent authority." },
  { title: "Volunteer", path: "/governance/roles/volunteer", description: "Volunteers run the Society. All positive decisions about the website and community work belong to volunteers." },
];

export default function Roles() {
  return (
    <PageLayout pageName="Roles" showComingSoon={false} parents={[{ name: "Governance", path: "/governance" }]}>
      <div className="role-index">
        {roles.map(({ title, path, description }) => (
          <Link key={path} to={path} className="role-index__item">
            <span className="role-index__title">{title}</span>
            <span className="role-index__description">{description}</span>
            <span className="role-index__arrow">→</span>
          </Link>
        ))}
      </div>
    </PageLayout>
  );
}
