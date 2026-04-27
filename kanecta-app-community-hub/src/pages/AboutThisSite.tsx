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

      <h3>Our Kaupapa</h3>
      <p>
        An open platform for anything Featherston — shared by locals, owned by
        the whole community.
      </p>
      <h4>A resource that belongs to everyone</h4>
      <p>
        All content and the software that powers this site are published under
        open source licences — free to{" "}
        <a href="https://github.com/cloudsculptor/featherston" target="_blank" rel="noopener noreferrer">
          download
        </a>
        , share, and reuse by anyone, no permission needed. If you ever decide this site isn't for you, your
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
        Our governance model draws on the principles of{" "}
        <a href="https://en.wikipedia.org/wiki/Sortition" target="_blank" rel="noopener noreferrer">
          sortition
        </a>{" "}
        — the selection of decision-makers by random lot — and{" "}
        <a href="https://en.wikipedia.org/wiki/Direct_democracy" target="_blank" rel="noopener noreferrer">
          direct democracy
        </a>
        , giving every community member an equal voice.
      </p>
      <h4>Free to use, free from influence</h4>
      <blockquote className="about-quote">
        "If you are not paying, you are the product."
      </blockquote>
      <p>
        We only accept small donations — up to $20 per year per person or
        organisation — as a guarantee that no individual, business, or funding
        body can gain undue influence over this site. There is no advertising,
        no sponsorship, and no funding arrangements that could allow any group
        to claim ownership or control.
      </p>
      <p>
        Posting information to the site is always free. That includes listing
        goods and services for sale, adding business listings, and contributing
        community content. The act of sharing information here costs nothing,
        and that will never change.
      </p>
      <p>
        This also means that larger organisations — charities, businesses,
        funders — cannot buy influence here, no matter their size or budget.
        A $20 contribution carries exactly the same weight as any other. If
        you want to shape this site, you do it by participating — not by
        spending.
      </p>
    </PageLayout>
  );
}
