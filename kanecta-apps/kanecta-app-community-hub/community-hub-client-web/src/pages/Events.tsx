import { useState, useEffect } from "react";
import {
  Accordion, AccordionSummary, AccordionDetails,
  Button, Divider, Typography, Alert, CircularProgress, Box,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AddIcon from "@mui/icons-material/Add";
import PageLayout from "../components/PageLayout";
import CC0Notice from "../components/CC0Notice";
import EventCard from "../components/events/EventCard";
import EventSubmitForm from "../components/events/EventSubmitForm";
import { getEvents, type Event } from "../api/events";
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

function isEventPast(event: Event): boolean {
  const referenceDate = event.end_date ?? event.start_date;
  const cutoff = new Date(referenceDate);
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

export default function Events() {
  const { authenticated } = useKeycloak();
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const emailVerified = authenticated && keycloak.tokenParsed?.email_verified === true;

  function loadEvents() {
    setLoading(true);
    setLoadError(false);
    getEvents()
      .then(setEvents)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadEvents(); }, []);

  const groups = groupByMonth(events);

  return (
    <PageLayout pageName="Events" showComingSoon={false}>

      {/* ── External links accordion ────────────────────────────────────── */}
      <Accordion disableGutters elevation={0} sx={{ border: "1px solid var(--border)", borderRadius: "6px !important", mb: 3 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography fontWeight={500}>Find events on other websites</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <ul>
            {EXTERNAL_LINKS.map(({ href, label, desc }) => (
              <li key={href}>
                <a href={href} target="_blank" rel="noopener noreferrer">{label}</a>
                {" "}— {desc}
              </li>
            ))}
          </ul>
        </AccordionDetails>
      </Accordion>

      {/* ── Event listing ───────────────────────────────────────────────── */}
      {loading && (
        <Box display="flex" justifyContent="center" py={4}>
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
            <Typography variant="body2" color="text.secondary" fontWeight={500}>
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

      {/* ── Submit CTA ──────────────────────────────────────────────────── */}
      <Box className="events-submit-cta" mt={4} mb={2}>
        {!authenticated && (
          <Box className="events-submit-cta__prompt">
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Want to list an event in Featherston?
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<AddIcon />}
              onClick={() => keycloak.login()}
            >
              Sign in or create a free account
            </Button>
          </Box>
        )}

        {authenticated && !emailVerified && (
          <Alert severity="info" icon={false} sx={{ display: "inline-flex", alignItems: "center" }}>
            Please verify your email address before submitting events.
          </Alert>
        )}

        {authenticated && emailVerified && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => setFormOpen(true)}
          >
            Submit an event
          </Button>
        )}
      </Box>

      <EventSubmitForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmitted={() => { setFormOpen(false); loadEvents(); }}
      />

      <CC0Notice />
    </PageLayout>
  );
}
