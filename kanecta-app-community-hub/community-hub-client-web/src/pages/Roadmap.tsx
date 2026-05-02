import PageLayout from "../components/PageLayout";

interface RoadmapItem {
  title: string;
  description: string;
  status: "live" | "in-progress" | "planned";
}

const items: RoadmapItem[] = [
  {
    title: "Discussions",
    description:
      "A place for conversations on any topic — from local events and transport to ideas for the site itself. Open to team members, with more community access coming as we grow.",
    status: "in-progress",
  },
  {
    title: "Download your data",
    description:
      "Discussions will be the first feature to generate real user data. This feature will let you download everything you've contributed — and access the public open-source data uploaded by the community.",
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
      <p>What we're building and what's coming next.</p>

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
          </div>
        ))}
      </div>
    </PageLayout>
  );
}
