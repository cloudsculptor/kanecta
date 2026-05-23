import { useState, useEffect, useCallback } from "react";
import {
  Divider, Typography, Alert, CircularProgress, Box, Chip, Button,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import PageLayout from "../components/PageLayout";
import CC0Notice from "../components/CC0Notice";
import EventCard from "../components/events/EventCard";
import EventInlineForm from "../components/events/EventInlineForm";
import { getEvents, getMyEvents, deleteEvent, type Event, type MyEvent } from "../api/events";
import { useKeycloak } from "../auth/KeycloakProvider";
import keycloak from "../auth/keycloak";

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

const STATUS_CHIP: Record<MyEvent["status"], { label: string; color: "warning" | "success" | "error" }> = {
  pending:  { label: "Pending review", color: "warning" },
  approved: { label: "Approved",       color: "success" },
  declined: { label: "Declined",       color: "error"   },
};

function formatNZDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-NZ", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function isEventPast(event: Event): boolean {
  const referenceDate = event.end_date ?? event.start_date;
  const cutoff = new Date(referenceDate + "T00:00:00");
  cutoff.setDate(cutoff.getDate() + 1);
  return cutoff <= new Date();
}

function groupByMonth(events: Event[]): { label: string; events: Event[] }[] {
  const groups = new Map<string, Event[]>();
  for (const event of events) {
    const d = new Date(event.start_date + "T00:00:00");
    const label = d.toLocaleDateString("en-NZ", { month: "long", year: "numeric" });
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(event);
  }
  return Array.from(groups.entries()).map(([label, events]) => ({ label, events }));
}

function MyEventRow({ event, onDeleted }: { event: MyEvent; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const chip = STATUS_CHIP[event.status];
  const canDelete = event.status === "pending" || event.status === "declined";

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await deleteEvent(event.id);
      onDeleted();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="my-event-row">
      <div className="my-event-row__main">
        <span className="my-event-row__title">{event.title}</span>
        <span className="my-event-row__date">{formatNZDate(event.start_date)}</span>
      </div>
      <div className="my-event-row__actions">
        <Chip label={chip.label} color={chip.color} size="small" />
        {event.status === "declined" && event.decline_reason && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {event.decline_reason}
          </Typography>
        )}
        {canDelete && (
          <Button
            size="small"
            color="error"
            startIcon={<DeleteOutlineIcon fontSize="small" />}
            onClick={handleDelete}
            disabled={deleting}
            sx={{ ml: 1 }}
          >
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        )}
        {confirmDelete && !deleting && (
          <Button size="small" onClick={() => setConfirmDelete(false)} sx={{ ml: 0.5 }}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export default function Events() {
  const { authenticated } = useKeycloak();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [myEvents, setMyEvents] = useState<MyEvent[]>([]);
  const emailVerified = keycloak.tokenParsed?.email_verified === true;

  const loadEvents = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    getEvents()
      .then(setEvents)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const loadMyEvents = useCallback(() => {
    if (!authenticated) return;
    getMyEvents().then(setMyEvents).catch(() => {});
  }, [authenticated]);

  useEffect(() => { loadEvents(); }, [loadEvents]);
  useEffect(() => { loadMyEvents(); }, [loadMyEvents]);

  const groups = groupByMonth(events);

  return (
    <PageLayout pageName="Events" showComingSoon={false}>

      {/* ── External links grid ─────────────────────────────────────────── */}
      <h3 className="events-external__heading">Find events on other websites</h3>
      <div className="events-external__grid">
        {EXTERNAL_LINKS.map(({ href, label, desc }) => (
          <a key={href} href={href} target="_blank" rel="noopener noreferrer" className="events-external__card">
            <span className="events-external__title">{label}</span>
            <span className="events-external__desc">{desc}</span>
            <span className="events-external__arrow">↗</span>
          </a>
        ))}
      </div>

      {/* ── Event listing ───────────────────────────────────────────────── */}
      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load events. Please try again later.
        </Alert>
      )}

      {!loading && !loadError && events.length === 0 && (
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          No upcoming events listed yet.
        </Typography>
      )}

      {!loading && !loadError && groups.map(({ label, events: groupEvents }) => (
        <section key={label} className="events-month">
          <Divider sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
              {label}
            </Typography>
          </Divider>
          <div className="events-list">
            {groupEvents.map((event) => (
              <EventCard key={event.id} event={event} past={isEventPast(event)} />
            ))}
          </div>
        </section>
      ))}

      {/* ── Your submitted events ───────────────────────────────────────── */}
      {authenticated && myEvents.length > 0 && (
        <section className="my-events">
          <h3 className="my-events__heading">Your submitted events</h3>
          <div className="my-events__list">
            {myEvents.map((event) => (
              <MyEventRow
                key={event.id}
                event={event}
                onDeleted={() => {
                  setMyEvents((prev) => prev.filter((e) => e.id !== event.id));
                  loadEvents();
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Inline submit form ──────────────────────────────────────────── */}
      <EventInlineForm
        authenticated={authenticated}
        emailVerified={emailVerified}
        onSubmitted={() => { loadEvents(); loadMyEvents(); }}
      />

      <CC0Notice />
    </PageLayout>
  );
}
