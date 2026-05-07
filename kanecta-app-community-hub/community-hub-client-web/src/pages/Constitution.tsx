import PageLayout from "../components/PageLayout";
// AsciiDoc import — remove alongside asciidocPlugin in vite.config.ts and asciidoc.d.ts
import constitutionHtml from "../../../featherston-constitution/constitution.adoc";

const kaupapa = [
  { title: "Openness", body: "Information, money, decisions, and code are all made public by default." },
  { title: "Anti-capture", body: "No individual, organisation, or funder may gain disproportionate influence over this Society." },
  { title: "Participatory democracy", body: "Power belongs to those who show up and contribute, not those with the most money or the loudest voice." },
  { title: "Sortition as a safeguard", body: "Random selection of certain roles prevents elections from being won by name recognition or campaign spending." },
  { title: "Sustainability", body: "The Society must be able to survive the departure of any single person, including its founders." },
  { title: "Community first", body: "The website and Society serve 100% of Featherston's residents, not any subset." },
];

const TAG_COLORS: Record<string, { bg: string; color: string }> = {
  "Openness":                { bg: "#dbeafe", color: "#1e40af" },
  "Anti-capture":            { bg: "#fce7f3", color: "#9d174d" },
  "Participatory democracy": { bg: "#fef3c7", color: "#92400e" },
  "Sortition as a safeguard":{ bg: "#ede9fe", color: "#5b21b6" },
  "Sustainability":          { bg: "#d1fae5", color: "#065f46" },
  "Community first":         { bg: "#ffedd5", color: "#9a3412" },
};

interface Scenario {
  title: string;
  description: string;
  tags?: string[];
}

const scenarios: Scenario[] = [
  // Kaupapa-derived — these map directly to the guiding principles
  {
    title: "Large donor buys influence",
    description: "A business or individual makes a substantial financial contribution and expects preferential treatment, veto power, or editorial control in return.",
    tags: ["Anti-capture"],
  },
  {
    title: "Founder treats the organisation as personal property",
    description: "An original founder resists any governance change, refuses to stand down from roles, or acts as though the organisation belongs to them personally.",
    tags: ["Anti-capture", "Sustainability"],
  },
  {
    title: "Coordinated voting bloc captures the board",
    description: "A group of friends or members of a single club all join at once and vote each other into every governance role, locking out the broader community.",
    tags: ["Anti-capture", "Participatory democracy"],
  },
  {
    title: "Popularity contest election",
    description: "A well-known local identity wins every election regardless of suitability, because name recognition beats governance capability.",
    tags: ["Sortition as a safeguard"],
  },
  {
    title: "Wealthy members expect more say",
    description: "Members who contribute more money pressure the board for extra influence over decisions, treating financial contribution as a proxy for voting weight.",
    tags: ["Participatory democracy", "Anti-capture"],
  },
  {
    title: "Financial records hidden from members",
    description: "A treasurer or board refuses to share accounts or spending details, making it impossible for members to detect misuse of funds.",
    tags: ["Openness"],
  },
  {
    title: "Decisions made in private",
    description: "Key decisions are made by a small group in informal settings with no minutes or public record, leaving members unable to understand or challenge them.",
    tags: ["Openness"],
  },
  {
    title: "Source code or data locked up by the administrator",
    description: "The person controlling the server or code repository refuses to hand over access, or leaves without transferring credentials.",
    tags: ["Openness", "Sustainability"],
  },
  {
    title: "Bus factor of one",
    description: "A single person holds all passwords, domain registrations, server access, and institutional knowledge. When they leave — planned or otherwise — the organisation is paralysed.",
    tags: ["Sustainability"],
  },
  {
    title: "Founder departure causes collapse",
    description: "The founding member leaves suddenly and the organisation cannot function because all processes, relationships, and know-how were concentrated in one person.",
    tags: ["Sustainability"],
  },
  {
    title: "Site drifts toward serving a single interest group",
    description: "Over time the site's content and tone shifts to focus on one group's concerns (e.g. a single political view, hobby, or demographic) and stops being useful to the whole community.",
    tags: ["Community first"],
  },
  {
    title: "Employer-sponsor conflict of interest",
    description: "A board member's employer becomes a major sponsor or advertiser, creating a financial conflict they do not disclose and do not recuse themselves from.",
    tags: ["Anti-capture", "Openness"],
  },
  {
    title: "Repeat incumbents accumulate power",
    description: "The same small group serves on the board term after term, building up institutional power and informal influence that makes it difficult for new members to participate meaningfully.",
    tags: ["Sortition as a safeguard"],
  },

  // General community group failure modes
  {
    title: "Insolvency",
    description: "The organisation spends beyond its means — through poor budgeting, unexpected costs, or loss of income — and cannot meet its financial obligations.",
  },
  {
    title: "Personal liability for committee members",
    description: "A committee member is personally sued or held liable for a decision made on behalf of the organisation, with no indemnity or insurance in place.",
  },
  {
    title: "Grant dependency collapse",
    description: "The organisation becomes entirely dependent on a single grant or funder. When that funding ends, there is no financial runway and operations cease abruptly.",
  },
  {
    title: "Undisclosed conflict of interest in procurement",
    description: "A board member awards a contract or resource to a business they have a personal financial stake in, without declaring the conflict.",
  },
  {
    title: "Quorum failure",
    description: "Meetings can never achieve quorum, making it impossible to pass resolutions, approve accounts, or fill vacancies — leaving the organisation in a governance limbo.",
  },
  {
    title: "Constitutional deadlock between factions",
    description: "Two evenly matched factions within the membership are unable to agree on any significant decisions, and the constitution provides no mechanism to break the deadlock.",
  },
  {
    title: "Removal of a rogue or disruptive member",
    description: "A member behaves harmfully — abusing other members, spreading misinformation, or refusing to follow process — but the constitution contains no clear mechanism to remove them.",
  },
  {
    title: "Emergency decision-making paralysis",
    description: "A crisis (legal, financial, reputational) requires urgent action but the formal governance process requires weeks of notice and meeting procedures.",
  },
  {
    title: "Constitutional amendment capture",
    description: "A faction recruits enough members to push through constitutional amendments that concentrate power in their favour, remove term limits, or undermine existing protections.",
  },
  {
    title: "Dissolution dispute",
    description: "Members cannot agree whether to wind up the organisation, and there is no clear process for deciding or for distributing assets if they do.",
  },
  {
    title: "Bullying and harassment within the organisation",
    description: "A board member, volunteer, or active user harasses others — in meetings, online, or privately — and there is no process to investigate or act on complaints.",
  },
  {
    title: "Whistleblower retaliation",
    description: "A member raises a concern about financial irregularities or misconduct and is subsequently ostracised, removed from roles, or harassed by those they reported.",
  },
  {
    title: "Discrimination in membership or decision-making",
    description: "Decisions or policies — deliberately or inadvertently — exclude or disadvantage people based on age, ethnicity, gender, disability, or socioeconomic status.",
  },
  {
    title: "Inadequate Māori or tangata whenua consultation",
    description: "The organisation makes decisions affecting the community without engaging with local iwi or hapū, damaging trust and potentially breaching treaty obligations.",
  },
  {
    title: "Personal data breach",
    description: "Member contact details, contribution records, or private messages are leaked, stolen, or inadvertently made public.",
  },
  {
    title: "Domain name hijacked or lost",
    description: "The domain registrar account lapses, credentials are stolen, or an individual transfers the domain without authorisation, cutting the organisation off from its primary address.",
  },
  {
    title: "Platform dependency — third-party shutdown",
    description: "The organisation's entire presence or data is hosted on a third-party platform that changes its terms, goes offline, or deletes the account.",
  },
  {
    title: "Cyberattack or ransomware",
    description: "The site or backend is compromised, defaced, or held to ransom, and the organisation has no incident response plan or backups.",
  },
  {
    title: "Defamation liability for user-posted content",
    description: "A member posts content on the site that exposes the organisation to a defamation claim, and it is unclear who is liable or what the moderation obligations are.",
  },
  {
    title: "Regulatory or legislative change",
    description: "A change in incorporated societies law, charity law, or privacy regulation creates new obligations the organisation is unaware of or unable to meet.",
  },
  {
    title: "Local political pressure to remove content",
    description: "A local councillor, politician, or powerful community figure pressures the organisation to remove or alter content they find unfavourable.",
  },
  {
    title: "Membership list misused",
    description: "A disgruntled ex-member or outgoing committee member uses the membership list to send unsolicited political messaging, spam, or harassment campaigns.",
  },
  {
    title: "Ghost voters — inactive member records",
    description: "A founder or long-standing member retains a large number of old or inactive member records that can be used to swing votes at AGMs.",
  },
  {
    title: "Proxy voting abuse",
    description: "A member collects proxy votes from friends or inactive members — sometimes using pressure or misinformation — to dominate a key vote.",
  },
  {
    title: "Eligibility disputes over membership",
    description: "Arguments arise about who genuinely qualifies as a Featherston resident or community member, with no objective or auditable criteria in the constitution.",
  },
  {
    title: "Volunteer burnout and role collapse",
    description: "The operational load falls on a tiny number of volunteers who eventually quit or burn out, leaving critical roles unfilled with no succession plan.",
  },
  {
    title: "No one willing to take on governance roles",
    description: "When terms expire, no members are willing to stand for the board or other roles, leaving the organisation without legitimate leadership.",
  },
  {
    title: "Mission creep beyond the founding purpose",
    description: "The organisation gradually takes on projects, opinions, or advocacy far outside its original purpose, alienating members and potentially breaching its rules.",
  },
  {
    title: "Duplication and conflict with existing community bodies",
    description: "The organisation starts competing with — rather than complementing — existing groups (residents' association, iwi, council) creating confusion, rivalry, and wasted effort.",
  },
  {
    title: "Reputational damage from a member's personal conduct",
    description: "A board member or prominent volunteer behaves badly in their personal life — publicly, online, or in another role — and the community associates that conduct with the organisation.",
  },
  {
    title: "Hosting or infrastructure provider failure",
    description: "A key service provider (hosting, email, backups) fails, is acquired, or changes pricing significantly, with no documented continuity plan.",
  },
  {
    title: "Unilateral action by a single office-holder",
    description: "A chair, treasurer, or administrator makes a significant financial, legal, or editorial decision without board approval, claiming they acted within their delegated authority.",
  },
  {
    title: "Minority community voices systematically excluded",
    description: "Governance processes — meeting times, language, formats, contribution thresholds — systematically disadvantage certain groups, meaning their interests are never represented.",
  },
  {
    title: "Scope captured by a single issue campaign",
    description: "A well-organised group with a single cause (e.g. opposing a development, promoting a political candidate) floods membership and briefly redirects the organisation's platform to their cause.",
  },
  {
    title: "Revenue model distorts editorial decisions",
    description: "If the organisation introduces any form of paid listing or commercial service, pressure emerges to give paying contributors more favourable treatment on the site.",
  },
  {
    title: "Council attempts to co-opt or suppress the site",
    description: "The local council — perceiving the independent community site as a threat or competitor — applies pressure, withholds cooperation, or attempts to subsume it under council control.",
  },
  {
    title: "Informal power supplants formal governance",
    description: "The real decisions are made in private group chats, friendships, or informal networks, while formal meetings become rubber-stamps — making accountability impossible.",
  },
  {
    title: "Key agreement or contract not in writing",
    description: "An important arrangement — hosting, moderation, data sharing — is agreed verbally or by email with no formal contract, leaving the organisation exposed when the arrangement breaks down.",
  },
  {
    title: "Insurance gap",
    description: "The organisation lacks appropriate public liability, cyber, or directors' and officers' insurance and faces a claim it cannot defend or pay.",
  },
  {
    title: "Lack of documented handover process",
    description: "When a key role changes hands, there is no documented handover procedure — the incoming person receives no briefing, no access credentials, and no record of ongoing obligations.",
  },
];

export default function Constitution() {
  return (
    <PageLayout pageName="Constitution" showComingSoon={false} parent={{ name: "Governance", path: "/governance" }}>
      <h3>Summary</h3>
      <p>This is a summary of the key principles in the draft constitution below.</p>
      <div className="kaupapa-callout">
        <p className="kaupapa-callout__intro">The Society is guided by the following principles, which inform every clause of this constitution:</p>
        <ol className="kaupapa-callout__list">
          {kaupapa.map(({ title, body }) => (
            <li key={title}>
              <strong>{title}</strong> — {body}
            </li>
          ))}
        </ol>
      </div>

      <h3 className="constitution-section-heading">Draft Constitution</h3>
      <p>
        This is the proposed constitution of Featherston Inc, prepared in accordance with the
        Incorporated Societies Act 2022. It is currently a draft — circulated for community
        consultation and not yet submitted for registration.
      </p>
      <p>
        <strong>Featherston Inc</strong> is a working name and placeholder — the final name will be
        decided by the community before the society is registered.
      </p>
      <p>
        References to <strong>Custodian A</strong>, <strong>Custodian B</strong>, and so on are
        placeholder names for the initial custodians, to be filled in before submission.
      </p>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: constitutionHtml }} />

      <h3 className="constitution-section-heading">Scenarios</h3>
      <p>
        These scenarios are used to evaluate the constitution against real-world problems.
      </p>
      <p>
        Scenarios derived directly from the Kaupapa principles are tagged. The remainder are
        common failure modes drawn from the experience of community groups, incorporated
        societies, and non-profit organisations.
      </p>
      <ol className="scenario-grid">
        {scenarios.map(({ title, description, tags }, i) => (
          <li key={title} className="scenario-card">
            <span className="scenario-card__number">{i + 1}</span>
            <div className="scenario-card__title">{title}</div>
            {tags && (
              <div className="scenario-card__tags">
                {tags.map(tag => {
                  const c = TAG_COLORS[tag];
                  return (
                    <span key={tag} className="scenario-card__tag"
                      style={c ? { "--tag-bg": c.bg, "--tag-color": c.color } as React.CSSProperties : undefined}>
                      {tag}
                    </span>
                  );
                })}
              </div>
            )}
            <div className="scenario-card__description">{description}</div>
          </li>
        ))}
      </ol>
    </PageLayout>
  );
}
