import { type Event } from "../../api/events";

interface Props {
  event: Event;
  past?: boolean;
}

function formatDate(date: string, time: string | null): string {
  const d = new Date(date + (time ? `T${time}` : "T00:00:00"));
  const dateStr = d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  if (!time) return dateStr;
  const timeStr = d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${dateStr} · ${timeStr}`;
}

function formatDateRange(event: Event): string {
  const start = formatDate(event.start_date, event.start_time);
  if (!event.end_date) return start;
  const end = formatDate(event.end_date, event.end_time);
  if (event.start_date === event.end_date) {
    if (!event.end_time) return start;
    const endTime = new Date(`${event.end_date}T${event.end_time}`).toLocaleTimeString("en-NZ", {
      hour: "numeric", minute: "2-digit", hour12: true,
    });
    return `${start} – ${endTime}`;
  }
  return `${start} – ${end}`;
}

export default function EventCard({ event, past = false }: Props) {
  const gallery = event.gallery_images.slice().sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  return (
    <article className={`event-card${past ? " event-card--past" : ""}`}>
      {event.hero_image && (
        <div className="event-card__hero">
          <img src={event.hero_image.url} alt={event.title} />
        </div>
      )}
      <div className="event-card__body">
        <h3 className="event-card__title">{event.title}</h3>
        <p className="event-card__date">{formatDateRange(event)}</p>
        {event.description && <p className="event-card__desc">{event.description}</p>}

        {(event.website || event.phone || event.email) && (
          <ul className="event-card__contact">
            {event.website && (
              <li>
                <a href={event.website} target="_blank" rel="noopener noreferrer">
                  {event.website.replace(/^https?:\/\//, "")}
                </a>
              </li>
            )}
            {event.phone && <li><a href={`tel:${event.phone}`}>{event.phone}</a></li>}
            {event.email && <li><a href={`mailto:${event.email}`}>{event.email}</a></li>}
          </ul>
        )}

        {gallery.length > 0 && (
          <div className="event-card__gallery">
            {gallery.map((img) => (
              <a key={img.file_id} href={img.url} target="_blank" rel="noopener noreferrer">
                <img src={img.url} alt="" />
              </a>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
