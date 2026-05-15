import PageLayout from "../components/PageLayout";

export default function Resilience() {
  return (
    <PageLayout pageName="Resilience" showComingSoon={false}>
      <p>
        A community-led resilience action plan to strengthen local resilience
        in Featherston — mapping existing services, identifying gaps, and
        agreeing on practical actions the community can take together.
      </p>

      <figure style={{ margin: "24px 0" }}>
        <img
          src="/resilience-framework.jpeg"
          alt="Community Resilience Action Plan framework diagram showing the four phases (Why, What, How, Weave) and six workstreams rooted in harakeke values"
          style={{ width: "100%", borderRadius: 8 }}
        />
        <figcaption style={{ fontSize: 13, marginTop: 8, opacity: 0.6 }}>
          Community Resilience Action Plan framework
        </figcaption>
      </figure>

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
    </PageLayout>
  );
}
