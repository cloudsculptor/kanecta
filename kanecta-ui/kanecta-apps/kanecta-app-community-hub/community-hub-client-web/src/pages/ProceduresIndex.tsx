import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const procedures = [
  {
    group: "Content & Community",
    items: [
      { title: "Content Moderation", path: "/governance/procedures/content-moderation", description: "How reported or problematic content is reviewed, removed, and escalated." },
      { title: "Volunteer Onboarding", path: "/governance/procedures/volunteer-onboarding", description: "How new volunteers are welcomed, given access, and supported." },
      { title: "Complaint Handling", path: "/governance/procedures/complaint-handling", description: "How formal complaints about member or volunteer conduct are investigated and resolved." },
    ],
  },
  {
    group: "Technology",
    items: [
      { title: "IT Incident Response", path: "/governance/procedures/it-incident-response", description: "How the team responds to outages, security incidents, and infrastructure failures." },
      { title: "Domain and Hosting Management", path: "/governance/procedures/domain-and-hosting", description: "Keeping featherston.co.nz and all hosting infrastructure secure and continuously available." },
      { title: "Backup and Recovery", path: "/governance/procedures/backup-and-recovery", description: "How site data is backed up, tested, and restored." },
    ],
  },
  {
    group: "Governance & Legal",
    items: [
      { title: "Board Meeting", path: "/governance/procedures/board-meeting", description: "How a standard Custodian Board meeting is prepared for and run." },
      { title: "Annual General Meeting", path: "/governance/procedures/agm", description: "How the AGM is planned, run, and recorded — including sortition." },
      { title: "Financial Reporting", path: "/governance/procedures/financial-reporting", description: "Day-to-day financial management, quarterly reporting, and annual accounts." },
      { title: "Statutory Compliance", path: "/governance/procedures/statutory-compliance", description: "Meeting the Society's legal obligations under the Incorporated Societies Act 2022." },
    ],
  },
];

export default function ProceduresIndex() {
  return (
    <PageLayout pageName="Procedures" showComingSoon={false} wip parents={[{ name: "Governance", path: "/governance" }]}>
      {procedures.map(({ group, items }) => (
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
