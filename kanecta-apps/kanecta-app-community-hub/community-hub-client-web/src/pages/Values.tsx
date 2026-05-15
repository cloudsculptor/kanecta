import PageLayout from "../components/PageLayout";

const values = [
  {
    title: "Open by default",
    body: "Everything we do, build, and decide is public. Code, finances, and decisions are available to all — not just members, not just insiders.",
  },
  {
    title: "Community owned, not captured",
    body: "No individual, organisation, or funder can gain disproportionate influence. Power is distributed, protected, and held in trust for the whole community.",
  },
  {
    title: "Free to use, free from influence",
    body: "Contributing to and using this site costs nothing. We accept only small donations — capped at $20 per person per year — so money cannot buy a louder voice.",
  },
  {
    title: "Those who do the work should lead",
    body: "Governance follows contribution. The people who show up consistently and do real work should have the most influence — not those with the most money, status, or name recognition.",
  },
  {
    title: "Good character matters",
    body: "Positivity, kindness, honesty, inclusiveness, and a genuine desire to serve the community are what we value in each other. These qualities should be what gets noticed.",
  },
  {
    title: "Make space for everyone",
    body: "We actively create room for every voice. Good ideas can come from anyone. People who help others contribute are as valuable as those who contribute directly.",
  },
  {
    title: "Built to last",
    body: "The organisation must survive the departure of any single person, including its founders. No one person should be a single point of failure.",
  },
  {
    title: "Fairness through randomness",
    body: "Key governance roles are filled by sortition — random selection from willing members — so they cannot be won by campaigning, popularity, or organised factions.",
  },
  {
    title: "Serve the whole community",
    body: "This site and organisation exist for 100% of Featherston's residents — not a subset, not a particular interest group, not whoever happens to be most involved at any given time.",
  },
];

export default function Values() {
  return (
    <PageLayout pageName="Values" showComingSoon={false} parents={[{ name: "Governance", path: "/governance" }]}>
      <div className="values-list">
        {values.map(({ title, body }) => (
          <div key={title} className="values-list__item">
            <h3 className="values-list__title">{title}</h3>
            <p className="values-list__body">{body}</p>
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
