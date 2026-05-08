import PageLayout from "../components/PageLayout";

const purposes = [
  {
    title: "Be the community's information home",
    body: "A single, reliable, independent source of information about Featherston — for residents, by residents. Not a council noticeboard, not a business directory, not a social media feed. A permanent resource the whole community can depend on.",
  },
  {
    title: "Hold the domain in trust",
    body: "featherston.co.nz is one of the most recognisable and authoritative addresses a community can have. This organisation exists to hold that domain permanently in trust for all residents — not for any individual, business, or interest group.",
  },
  {
    title: "Serve every resident equally",
    body: "The site exists for 100% of Featherston's people — newcomers and long-timers, every background, every part of town. No group gets preferential treatment, and no community voice is more important than another.",
  },
  {
    title: "Resist capture — permanently",
    body: "Community resources have a long history of being taken over: by well-meaning founders who won't let go, by funders who want influence, by organised factions with a particular agenda. This organisation is built from the ground up to make that structurally impossible.",
  },
  {
    title: "Keep community knowledge open",
    body: "All content and code are published under open licences. If this organisation ever fails, the knowledge and tools it has built don't disappear — they remain freely available for anyone to carry forward. Community knowledge belongs to the community.",
  },
  {
    title: "Support community connection and action",
    body: "Beyond publishing information, provide the infrastructure for the community to connect, organise, and work together on what matters locally — resilience, mutual aid, shared skills, and everything else that makes a town a real community.",
  },
];

export default function Purpose() {
  return (
    <PageLayout pageName="Purpose" showComingSoon={false} parents={[{ name: "Governance", path: "/governance" }]}>
      <h3>Mission</h3>
      <p className="gov-lead">A community-owned digital platform, holding featherston.co.nz in permanent trust for all residents of Featherston.</p>

      <h3 className="constitution-section-heading">Vision</h3>
      <p className="gov-lead">Featherston has a trusted, permanent digital home — community-governed, impossible to capture, and still running long after the people who built it have moved on.</p>

      <h3 className="constitution-section-heading">What we're here to do</h3>
      <div className="values-list">
        {purposes.map(({ title, body }) => (
          <div key={title} className="values-list__item">
            <h3 className="values-list__title">{title}</h3>
            <p className="values-list__body">{body}</p>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
