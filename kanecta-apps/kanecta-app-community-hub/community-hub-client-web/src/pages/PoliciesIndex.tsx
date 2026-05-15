import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const policies = [
  {
    group: "Custodian Board",
    items: [
      { title: "Bylaws", path: "/governance/policies/custodian-bylaws", description: "Formal, binding rules for how the Custodian Board operates." },
      { title: "Guidelines", path: "/governance/policies/custodian-guidelines", description: "Practical guidance for Board members on running meetings, working with volunteers, and handing over." },
    ],
  },
  {
    group: "Volunteers",
    items: [
      { title: "Bylaws", path: "/governance/policies/volunteer-bylaws", description: "Formal expectations for volunteers — minimal by design." },
      { title: "Guidelines", path: "/governance/policies/volunteer-guidelines", description: "Practical guidance on how work gets done, decisions get made, and concerns get raised." },
    ],
  },
];

export default function PoliciesIndex() {
  return (
    <PageLayout pageName="Policies" showComingSoon={false} parents={[{ name: "Governance", path: "/governance" }]}>
      {policies.map(({ group, items }) => (
        <div key={group} className="policy-group">
          <h3 className="policy-group__heading">{group}</h3>
          <div className="role-index">
            {items.map(({ title, path, description }) => (
              <Link key={path} to={path} className="role-index__item">
                <span className="role-index__title">{title}</span>
                <span className="role-index__description">{description}</span>
                <span className="role-index__arrow">→</span>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </PageLayout>
  );
}
