import PageLayout from "../components/PageLayout";

export default function AboutThisSite() {
  return (
    <PageLayout pageName="About this site" showComingSoon={false}>
      <p>
        This site exists as an information source for the people of{" "}
        <a
          href="https://en.wikipedia.org/wiki/Featherston,_New_Zealand"
          target="_blank"
          rel="noopener noreferrer"
        >
          Featherston
        </a>{" "}
        and our visitors.
      </p>

      <h3>How this site came about</h3>
      <p>
        This site grew out of the{" "}
        <strong>Paetūmokai Resilience Action Plan</strong> — a community-led
        process convened by Paetūmokai Kai Tahi (PKT) to strengthen local
        resilience in Featherston. Through a series of community hui, locals
        came together to map existing services, identify gaps, and agree on
        practical actions that could begin immediately.
      </p>
      <p>
        At Hui 2, the Communications and Coordination group identified the need
        for a dedicated community website as a key action. This site is the
        result of that mahi. It is community-driven and community-owned — not
        funded or controlled by PKT or any other organisation.
      </p>

      <h3>What the community told us</h3>
      <p>
        A community survey carried out before Hui 2 revealed the scale of
        concern and the appetite for local action:
      </p>
      <ul>
        <li><strong>78%</strong> expressed concern about rising kai costs and pressure on household budgets</li>
        <li><strong>74%</strong> indicated interest in learning practical skills to strengthen household resilience</li>
        <li><strong>72%</strong> identified fuel prices and transport costs as a significant worry</li>
        <li><strong>71%</strong> wanted to be more involved in local food growing, sharing, or preparation</li>
        <li><strong>69%</strong> were concerned about access to essential goods if supply chains are disrupted</li>
        <li><strong>67%</strong> supported stronger local coordination between community organisations and services</li>
        <li><strong>63%</strong> said they would be willing to share skills, resources, or time to support others</li>
        <li><strong>61%</strong> identified access to affordable seedlings or support to grow kai at home as important</li>
        <li><strong>58%</strong> expressed interest in participating in local resilience and mutual support networks</li>
        <li><strong>55%</strong> indicated interest in shared transport options or local coordination if fuel costs increase</li>
      </ul>

      <h3>The six workstreams</h3>
      <p>
        The hui identified six resilience workstreams that form the backbone of
        the community action plan — and the categories on this site:
      </p>
      <ul>
        <li><strong>Kai</strong> — local food production, sharing, bulk buying, and food security</li>
        <li><strong>Transport &amp; Mobility</strong> — ride sharing, reducing fuel dependency, supporting those without transport</li>
        <li><strong>Skill Sharing</strong> — skill fairs, workshops, and connecting people with practical knowledge</li>
        <li><strong>Social Services</strong> — identifying households needing support and strengthening local service coordination</li>
        <li><strong>Communication Networks</strong> — noticeboards, information flow, and coordination during disruption</li>
        <li><strong>Local Economy</strong> — strengthening local exchange, supporting local producers, timebanking</li>
      </ul>
      <p>
        The guiding vision: <em>Local Knowledge, Shared Action, Shared Resilience.</em>
      </p>

      <h3>Our Kaupapa</h3>
      <p>
        An open platform for anything Featherston — shared by locals, owned by
        the whole community.
      </p>
      <h4>A resource that belongs to everyone</h4>
      <p>
        All content and the software that powers this site are published under
        open source licences — free to download, share, and reuse by anyone, no
        permission needed. If you ever decide this site isn't for you, your
        contributions aren't lost or locked away. You can take a full copy and
        host it elsewhere. Everything contributed here is a gift to the public,
        and nobody can ever take that away.
      </p>
      <h4>Open governance and ownership</h4>
      <p>
        Running a site like this requires real decisions: someone has to own the
        domain, pay for hosting, write and maintain the code, manage backups and
        administration, moderate content, set priorities, and make calls when
        things are unclear.
      </p>
      <p>
        Concentrated power corrupts — and great governance is one of humanity's
        oldest unsolved problems. So the guiding principle here is to distribute
        that power as widely as possible, and to build in every safeguard we can
        against this site being captured by any individual or special interest
        group.
      </p>
      <p>
        Read more about our <a href="/about/governance">governance structure</a>.
      </p>
    </PageLayout>
  );
}
