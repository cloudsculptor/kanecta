import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

interface RoadmapItem {
  title: string;
  description: React.ReactNode;
  status: "live" | "in-progress" | "planned";
  to?: string;
}

const items: RoadmapItem[] = [
  {
    title: "Constitution",
    description: (
      <>
        Drafting a constitution so we can register as an{" "}
        <a
          href="https://is-register.companiesoffice.govt.nz/help-centre/starting-an-incorporated-society/applying-to-incorporate-a-society/"
          target="_blank"
          rel="noopener noreferrer"
        >
          incorporated society
        </a>{" "}
        under New Zealand law — giving the community formal legal standing and ensuring no single
        person controls the platform.
      </>
    ),
    status: "in-progress",
    to: "/constitution",
  },
  {
    title: "Discussions",
    description:
      "A place for conversations on any topic, and ideas for the site itself. Open to team members, with more community access coming as we grow.",
    status: "in-progress",
    to: "/discussions",
  },
  {
    title: "Download your data",
    description:
      "Discussions will be the first feature to generate real user data. This feature will let you download everything you've contributed — and access the public open-source data uploaded by the community.",
    status: "planned",
  },
  {
    title: "Upload suggested content",
    description:
      "Will allow users to upload text and files to be added to the site. They will need to pick a licence for their contribution ie public/open source or copyright.  Initially they won't be placing it in the actual page, this will be done by the developer after checking with the community.  However future functionality will allow direct page editing for group controlled pages.",
    status: "planned",
  },
  {
    title: "Tree of trust",
    description:
      "At the moment anybody can sign up for an account, but a technical admin needs to manually grant users a 'team' role before they can interact with the site.  The Tree of Trust will allow community members to show they know and trust someone to allow them to to contribute without the need for technical admin assistance.",
    status: "planned",
  },
  {
    title: "Open statistics",
    description: "Showing user counts and page view counts.",
    status: "planned",
  },
  {
    title: "Open governance",
    description:
      "Bringing visibility to finances, decisions and actions taken by volunteers, also voting/polling tools to allow users to help volunteers guide the site.",
    status: "planned",
  },
];

const STATUS_LABEL: Record<RoadmapItem["status"], string> = {
  live: "Live",
  "in-progress": "In progress",
  planned: "Planned",
};

export default function Roadmap() {
  return (
    <PageLayout pageName="Roadmap" showComingSoon={false}>
      <p>What we're building and idea's of what might come next.</p>

      <div className="roadmap-list">
        {items.map((item) => (
          <div key={item.title} className="roadmap-item">
            <div className="roadmap-item__header">
              <h2 className="roadmap-item__title">{item.title}</h2>
              <span className={`roadmap-item__status roadmap-item__status--${item.status}`}>
                {STATUS_LABEL[item.status]}
              </span>
            </div>
            <p className="roadmap-item__description">{item.description}</p>
            {item.to === "/constitution" && (
              <Link to={item.to} className="roadmap-item__learn-more">See draft constitution →</Link>
            )}
            {item.to === "/discussions" && (
              <Link to={item.to} className="roadmap-item__learn-more">See discussions page (under development) →</Link>
            )}
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
