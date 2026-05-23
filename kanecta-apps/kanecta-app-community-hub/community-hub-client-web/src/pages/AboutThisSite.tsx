import Tooltip from "@mui/material/Tooltip";
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
        All content and the software that powers this site are published under{" "}
        <Tooltip
          enterDelay={300}
          title={
            <span style={{ lineHeight: 1.6 }}>
              Software:{" "}
              <a href="https://en.wikipedia.org/wiki/MIT_License" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                MIT
              </a>
              <br />
              Content:{" "}
              <a href="https://en.wikipedia.org/wiki/Creative_Commons_license" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                Creative Commons
              </a>
            </span>
          }
        >
          <span style={{ textDecoration: "underline dotted", cursor: "help" }}>
            open source licences
          </span>
        </Tooltip>
        {" "}— free to{" "}
        <a href="https://github.com/cloudsculptor/kanecta" target="_blank" rel="noopener noreferrer">
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
      <h4>A better place to build community</h4>
      <p>
        Platforms like Facebook are free to use, but that freedom comes at a cost. The product being
        sold is you — your attention, your data, and your behaviour, packaged up and sold to advertisers.
        The algorithm is designed to maximise engagement, not wellbeing: it surfaces content that provokes
        strong reactions, keeps you scrolling, and rewards the loudest voices over the most thoughtful ones.
      </p>
      <p>
        That's not a great foundation for building a real community. Nuanced local discussion gets lost
        in the noise. Useful information disappears down the feed. The people who show up consistently
        and contribute meaningfully aren't rewarded — the ones who generate the most clicks are.
      </p>
      <p>
        This site is built differently. There's no advertising, no algorithm trying to keep you addicted,
        and no outside interest deciding what you see. It's a calm, purposeful space — designed to be
        genuinely useful, not endlessly engaging.
      </p>
      <h4>Free to use, free from influence</h4>
      <p>
        We only accept small donations as a guarantee that no individual,
        business, or funding body can gain undue influence over this site.
        There is no advertising, no sponsorship, and no funding arrangements
        that could allow any group to claim ownership or control.
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
        Every donation carries exactly the same weight. If you want to shape
        this site, you do it by participating — not by spending.
      </p>
    </PageLayout>
  );
}
