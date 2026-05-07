import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const principles = [
  {
    heading: "People who do the work lead the organisation",
    body: "Volunteers don't assist a committee - they are the organisation. Every decision about what to build, what to publish, and how to serve the community belongs to the people doing the work. No approval required.",
  },
  {
    heading: "A good culture is the foundation of everything",
    body: "The whole governance structure exists to protect and nurture the volunteer culture. When the culture is right - cooperative, caring, energetic - everything else follows. When it isn't, no amount of formal process will fix it.",
  },
  {
    heading: "Safety and support, not control",
    body: "The Custodian Board isn't there to manage volunteers. It's a safety net: chosen by random selection so it can't be captured, and empowered only to step in when something genuinely goes wrong.",
  },
];

export default function Governance() {
  return (
    <PageLayout pageName="Governance" showComingSoon={false}>

      <p className="gov-lead">
        This is a volunteer-led organisation. The people who show up and do the work should be the people who lead it.
      </p>

      <div className="gov-hero">
        <p className="gov-hero__sub">How do we create the conditions for a brilliant team of volunteers - and then get out of their way?</p>
        <ul className="gov-hero__list">
          <li>The people willing to do the real, consistent, day-in day-out work should be the ones with the most influence.</li>
          <li>Influence should grow with good character - positivity, kindness, honesty, inclusiveness, and a genuine service ethic toward the community.</li>
          <li>People who actively make space for others, who want every voice heard and every contribution valued, should naturally rise.</li>
          <li>The goal is a team where great human qualities are what get noticed - not loudness, status, or who shows up to the right meetings.</li>
        </ul>
      </div>

      <div className="gov-section">
        <h3 className="gov-section__heading">Volunteer culture</h3>
        <p>
          This is the kind of team people genuinely want to be part of.
          A group with real energy and momentum. People who care about the community, enjoy
          working together, look out for each other, and find the work meaningful and fun.
        </p>
        <p>
          Recruitment takes care of itself. New volunteers join because they want to be around
          great people doing something worthwhile - not because they were asked nicely or because
          there was a vacancy to fill.
        </p>
        <p>
          Volunteers self-organise. They set their own priorities. They make decisions together
          without needing sign-off from a committee. The energy stays with the people doing
          the work.
        </p>
      </div>

      <div className="gov-section">
        <h3 className="gov-section__heading">Supporting our volunteers</h3>
        <p>
          Even the best teams occasionally have problems. Someone behaves badly. A conflict
          escalates. A decision is made that damages trust. There is a structure in place for
          when that happens.
        </p>
        <p>
          The Custodian Board is a small group of five community members, chosen by random
          selection (sortition) from among our voting members. Sortition means the Board can't
          be stacked by friends, captured by a faction, or dominated by whoever campaigns
          hardest. It reflects the community as it is.
        </p>
        <p>
          The Board's job is not to run things - it's to protect people. It investigates
          complaints, mediates disputes, and in serious cases removes a volunteer who has acted
          against our values. Beyond that, it stays out of the way. Volunteers don't need
          permission. They need to feel safe.
        </p>
      </div>

      <div className="gov-principles">
        {principles.map(({ heading, body }) => (
          <div key={heading} className="gov-principles__item">
            <h4 className="gov-principles__heading">{heading}</h4>
            <p className="gov-principles__body">{body}</p>
          </div>
        ))}
      </div>

      <div className="gov-links">
        <Link to="/governance/values" className="gov-links__item">
          <span className="gov-links__title">Values</span>
          <span className="gov-links__desc">What we stand for</span>
          <span className="gov-links__arrow">→</span>
        </Link>
        <Link to="/governance/roles" className="gov-links__item">
          <span className="gov-links__title">Roles</span>
          <span className="gov-links__desc">Who does what, and how roles are filled</span>
          <span className="gov-links__arrow">→</span>
        </Link>
        <Link to="/governance/constitution" className="gov-links__item">
          <span className="gov-links__title">Constitution</span>
          <span className="gov-links__desc">The legal framework for this organisation</span>
          <span className="gov-links__arrow">→</span>
        </Link>
      </div>

    </PageLayout>
  );
}
