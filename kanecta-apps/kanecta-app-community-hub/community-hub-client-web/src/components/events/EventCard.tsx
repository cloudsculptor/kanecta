import { useState } from "react";
import { type Event } from "../../api/events";
import { formatEventDate, formatNZTime } from "../../utils/dates";

interface Props {
  event: Event;
  past?: boolean;
  onDelete?: () => Promise<void>;
}

function formatDateRange(event: Event): string {
  const start = formatEventDate(event.start_date, event.start_time);
  if (!event.end_date) return start;
  if (event.start_date === event.end_date) {
    if (!event.end_time) return start;
    return `${start} – ${formatNZTime(event.end_time)}`;
  }
  return `${start} – ${formatEventDate(event.end_date, event.end_time)}`;
}

export default function EventCard({ event, past = false, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return; }
    setDeleting(true);
    try {
      await onDelete!();
    } catch {
      setDeleting(false);
      setConfirming(false);
    }
  }
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

        {event.address && (
          <p className="event-card__address">
            {event.lat && event.lng ? (
              <a
                href={`https://www.openstreetmap.org/?mlat=${event.lat}&mlon=${event.lng}&zoom=16`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {event.address}
              </a>
            ) : event.address}
          </p>
        )}

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

      {onDelete && (
        <div className="event-card__actions">
          <button
            className="event-card__delete-btn"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : confirming ? "Confirm delete" : "Delete"}
          </button>
          {confirming && !deleting && (
            <button
              className="event-card__delete-cancel"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </article>
  );
}
