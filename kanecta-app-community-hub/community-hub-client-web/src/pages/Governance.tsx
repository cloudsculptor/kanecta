import PageLayout from "../components/PageLayout";

const roles = [
  {
    title: "Voter",
    description:
      "A Featherston local who has contributed $5 or more in the last 12 months and is available and willing to serve as a custodian or board member if chosen by sortition.",
  },
  {
    title: "Custodian",
    description: "5 people chosen by sortition from the pool of voters.",
    tags: ["1 year term", "Meets quarterly"],
  },
  {
    title: "Board Member",
    description: "5 people chosen by sortition from the pool of voters.",
    tags: ["1 year term", "Meets monthly"],
  },
  {
    title: "Site Manager",
    description:
      "Makes day-to-day content and moderation decisions on behalf of the community.",
    tags: ["1 year term", "Chosen by board"],
  },
  {
    title: "Administrator",
    description:
      "Manages the domain, hosting, source code, deployment, backups, and updates.",
    tags: ["1 year term", "Chosen by board"],
  },
  {
    title: "Volunteer",
    description:
      "Contributes to writing and maintaining the site. Works alongside the administrator, managed by the site manager.",
  },
];

export default function Governance() {
  return (
    <PageLayout pageName="Governance" showComingSoon={false}>
      <h3>Roles &amp; Responsibilities</h3>
      <div className="role-grid">
        {roles.map((role) => (
          <div key={role.title} className="role-card">
            <h4 className="role-card__title">{role.title}</h4>
            <p className="role-card__description">{role.description}</p>
            {role.tags && (
              <div className="role-card__tags">
                {role.tags.map((tag) => (
                  <span key={tag} className="role-card__tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>      
    </PageLayout>
  );
}
