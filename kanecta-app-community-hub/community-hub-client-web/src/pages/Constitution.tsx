import PageLayout from "../components/PageLayout";
// AsciiDoc import — remove alongside asciidocPlugin in vite.config.ts and asciidoc.d.ts
import constitutionHtml from "../../../featherston-constitution/constitution.adoc";

export default function Constitution() {
  return (
    <PageLayout pageName="Constitution" showComingSoon={false} parent={{ name: "Governance", path: "/governance" }}>
      <div className="adoc-content" dangerouslySetInnerHTML={{ __html: constitutionHtml }} />
    </PageLayout>
  );
}
