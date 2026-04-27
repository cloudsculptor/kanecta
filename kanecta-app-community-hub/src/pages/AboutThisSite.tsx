import PageLayout from "../components/PageLayout";

export default function AboutThisSite() {
  return (
    <PageLayout pageName="About this site" showComingSoon={false}>
      <p>
        This site exists as an information source for the people of{" "}
        <a
          href="https://en.wikipedia.org/wiki/Featherston,_New_Zealand"
          target="_blank"
        >
          Featherston
        </a>{" "}
        and our visitors.
      </p>
      <h3>Our Kaupapa</h3>
      <p>
        An open platform for anything Featherston - shared by locals, owned by
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
