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

export default function Constitution() {
  return (
    <PageLayout pageName="Constitution" showComingSoon={false} parent={{ name: "Governance", path: "/governance" }}>
      <h3>Summary</h3>
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
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: constitutionHtml }} />
    </PageLayout>
  );
}
