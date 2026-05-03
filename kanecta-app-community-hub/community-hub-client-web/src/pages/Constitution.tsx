import PageLayout from "../components/PageLayout";

export default function Constitution() {
  return (
    <PageLayout pageName="Constitution" showComingSoon={false}>
      <p>
        Featherston.co.nz is working towards becoming a registered{" "}
        <a
          href="https://www.companiesoffice.govt.nz/all-registers/incorporated-societies/"
          target="_blank"
          rel="noopener noreferrer"
        >
          incorporated society
        </a>{" "}
        under New Zealand law. Incorporation gives the community formal legal standing — allowing
        the organisation to open a bank account in its own name, enter into contracts, and operate
        with clear governance that no single individual controls.
      </p>

      <h3>Why incorporate?</h3>
      <p>
        Right now the site is run informally by volunteers. Incorporation means the community itself
        — not any individual — owns the platform. It protects volunteers from personal liability and
        makes the governance model legally enforceable rather than just aspirational.
      </p>

      <h3>The constitution</h3>
      <p>
        Every incorporated society must have a constitution that sets out its purpose, how decisions
        are made, and how the organisation is governed. Ours will reflect the principles already
        described on the{" "}
        <a href="/about/governance">governance page</a>: distributed power, sortition, and direct
        community participation.
      </p>
      <p>
        The draft constitution is being developed openly. Once ready it will be published here for
        community feedback before the society is registered.
      </p>

      <h3>How to get involved</h3>
      <p>
        If you have experience with incorporated societies, legal drafting, or community governance
        and would like to help, join the discussion in the{" "}
        <a href="/discussions">Discussions</a> area (team access required).
      </p>
    </PageLayout>
  );
}
