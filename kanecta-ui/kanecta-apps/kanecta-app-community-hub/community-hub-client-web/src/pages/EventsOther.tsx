import PageLayout from "../components/PageLayout";

const EXTERNAL_LINKS = [
  {
    href: "https://featherstoninfo.nz/",
    label: "Featherston Info",
    desc: "local information site with news and upcoming events",
  },
  {
    href: "https://featherston.org.nz/events/",
    label: "Featherston NZ — Events",
    desc: "community-run listing of local events and activities",
  },
  {
    href: "https://www.eventfinda.co.nz/whatson/events/featherston",
    label: "Eventfinda — Featherston",
    desc: "searchable event listings for Featherston and the region",
  },
  {
    href: "https://www.waieventhub.co.nz/",
    label: "Wairarapa Event Hub",
    desc: "regional events aggregator covering the wider Wairarapa",
  },
  {
    href: "https://www.facebook.com/featherston.wairarapa/",
    label: "Featherston, Wairarapa (Facebook)",
    desc: "local Facebook page with community news and events",
  },
  {
    href: "https://www.booktown.org.nz/",
    label: "Featherston Booktown Karukatea Festival",
    desc: "annual literary festival held each May, one of New Zealand's premier book events",
  },
];

const PARENTS = [{ name: "Events", path: "/events" }];

export default function EventsOther() {
  return (
    <PageLayout pageName="Find events on other websites" showComingSoon={false} parents={PARENTS}>
      <p>Other websites that list events happening in Featherston and the wider Wairarapa region.</p>
      <div className="events-external__grid">
        {EXTERNAL_LINKS.map(({ href, label, desc }) => (
          <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="events-external__card">
            <span className="events-external__title">{label}</span>
            <span className="events-external__desc">{desc}</span>
            <span className="events-external__arrow">↗</span>
          </a>
        ))}
      </div>
    </PageLayout>
  );
}
