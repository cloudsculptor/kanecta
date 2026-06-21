import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const roles = [
  { title: "Custodian", path: "/governance/roles/custodian", description: "The sortition-selected oversight body. Protects the community's interests without directing day-to-day work." },
  { title: "Volunteer", path: "/governance/roles/volunteer", description: "Volunteers run the Society. All positive decisions about the website and community work belong to volunteers." },
];

export default function Roles() {
  return (
    <PageLayout pageName="Roles" showComingSoon={false} wip parents={[{ name: "Governance", path: "/governance" }]}>
      <div className="role-index">
        {roles.map(({ title, path, description }) => (
          <div key={path} className="role-index__item-wrap">
            <Link to={path} className="role-index__item">
              <span className="role-index__title">{title}</span>
              <span className="role-index__description">{description}</span>
            </Link>
            <div className="role-index__right">
              <span className="role-index__arrow">→</span>
            </div>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
