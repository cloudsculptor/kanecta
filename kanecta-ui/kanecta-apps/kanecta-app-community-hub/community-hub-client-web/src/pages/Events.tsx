import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Divider, Typography, Alert, CircularProgress, Box, Chip, Button,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import PageLayout from "../components/PageLayout";
import CC0Notice from "../components/CC0Notice";
import EventCard from "../components/events/EventCard";
import EventInlineForm from "../components/events/EventInlineForm";
import EventEditDialog from "../components/events/EventEditDialog";
import { getEvents, getMyEvents, deleteEvent, AREAS, type Event, type MyEvent } from "../api/events";
import { useKeycloak } from "../auth/KeycloakProvider";
import keycloak from "../auth/keycloak";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { formatNZDate, parseNZDate } from "../utils/dates";

const SAMPLE_EVENT: Event = {
  id: "sample",
  title: "Community Working Bee",
  description: "Join us for a morning of working together on community projects around town. All welcome — just turn up and lend a hand.",
  start_date: "2026-06-14",
  start_time: "09:00:00",
  end_date: null,
  end_time: null,
  address: "Featherston Domain, Featherston",
  lat: -41.1167,
  lng: 175.3333,
  website: "https://featherston.co.nz",
  phone: null,
  email: null,
  area: "Featherston",
  organiser_name: null,
  organiser_email: null,
  organiser_phone: null,
  submitted_at: "2026-05-01T00:00:00Z",
  hero_image: { file_id: "sample-hero", url: "/communiy-working-bee-sample.jpg" },
  gallery_images: [],
};

const STATUS_CHIP: Record<MyEvent["status"], { label: string; color: "warning" | "success" | "error" }> = {
  pending:  { label: "Pending review", color: "warning" },
  approved: { label: "Approved",       color: "success" },
  declined: { label: "Declined",       color: "error"   },
};

function isEventPast(event: Event): boolean {
  const cutoff = parseNZDate(event.end_date ?? event.start_date);
  cutoff.setDate(cutoff.getDate() + 1);
  return cutoff <= new Date();
}

function groupByMonth(events: Event[]): { label: string; events: Event[] }[] {
  const groups = new Map<string, Event[]>();
  const sorted = [...events].sort((a, b) => a.start_date.localeCompare(b.start_date));
  for (const event of sorted) {
    const label = parseNZDate(event.start_date).toLocaleDateString("en-NZ", { month: "long", year: "numeric" });
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(event);
  }
  return Array.from(groups.entries()).map(([label, events]) => ({ label, events }));
}

function MyEventRow({ event, onDeleted, onEdit }: { event: MyEvent; onDeleted: () => void; onEdit: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const chip = STATUS_CHIP[event.status];

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
        <span className="my-event-row__date">{formatNZDate(event.start_date, { day: "numeric", month: "short", year: "numeric" })}</span>
      </div>
      <div className="my-event-row__actions">
        <Chip label={chip.label} color={chip.color} size="small" />
        {event.status === "declined" && event.decline_reason && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {event.decline_reason}
          </Typography>
        )}
        <Button
          size="small"
          startIcon={<EditOutlinedIcon fontSize="small" />}
          onClick={onEdit}
          sx={{ ml: 1 }}
        >
          Edit
        </Button>
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon fontSize="small" />}
          onClick={handleDelete}
          disabled={deleting}
          sx={{ ml: 0.5 }}
        >
          {confirmDelete ? "Confirm delete" : "Delete"}
        </Button>
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
  const roles = useUserRoles();
  const isModerator = hasRole(roles, "moderator");
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [myEvents, setMyEvents] = useState<MyEvent[]>([]);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
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

  const [selectedAreas, setSelectedAreas] = useState<string[]>(["Featherston"]);

  function toggleArea(area: string) {
    setSelectedAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  }

  const filteredEvents = selectedAreas.length === 0
    ? events
    : events.filter((e) => selectedAreas.includes(e.area));

  const groups = groupByMonth(filteredEvents);

  return (
    <PageLayout pageName="Events" showComingSoon={false}>

      {/* ── External links card ─────────────────────────────────────────── */}
      <Link to="/events/other" className="events-external__card events-external__card--solo">
        <span className="events-external__title">Find events on other websites</span>
        <span className="events-external__desc">Featherston Info, Eventfinda, Wairarapa Event Hub, and more</span>
        <span className="events-external__arrow">→</span>
      </Link>

      {/* ── Area filter ─────────────────────────────────────────────────── */}
      <div className="events-area-filter">
        {AREAS.map((area) => (
          <Chip
            key={area}
            label={area}
            onClick={() => toggleArea(area)}
            color={selectedAreas.includes(area) ? "primary" : "default"}
            variant={selectedAreas.includes(area) ? "filled" : "outlined"}
            size="small"
          />
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
        <>
          <div className="event-sample-wrap">
            <EventCard event={SAMPLE_EVENT} />
            <div className="event-sample-wrap__label">SAMPLE</div>
          </div>
        </>
      )}

      {!loading && !loadError && filteredEvents.length > 0 && groups.map(({ label, events: groupEvents }) => (
        <section key={label} className="events-month">
          <Divider sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, my: 0, lineHeight: 1 }}>
              {label}
            </Typography>
          </Divider>
          <div className="events-list">
            {groupEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                past={isEventPast(event)}
                onDelete={isModerator ? async () => {
                  await deleteEvent(event.id);
                  setEvents((prev) => prev.filter((e) => e.id !== event.id));
                } : undefined}
              />
            ))}
          </div>
        </section>
      ))}

      {!loading && !loadError && events.length > 0 && filteredEvents.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: "center" }}>
          No events in the selected areas.
        </Typography>
      )}

      {/* ── Your submitted events ───────────────────────────────────────── */}
      {authenticated && myEvents.length > 0 && (
        <section className="my-events">
          <h3 className="my-events__heading">Your submitted events</h3>
          <div className="my-events__list">
            {myEvents.map((event) => (
              <MyEventRow
                key={event.id}
                event={event}
                onEdit={() => setEditingEventId(event.id)}
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

      <EventEditDialog
        eventId={editingEventId}
        onClose={() => setEditingEventId(null)}
        onSaved={() => { loadEvents(); loadMyEvents(); }}
      />
    </PageLayout>
  );
}
