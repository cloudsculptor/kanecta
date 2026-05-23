import { useState, useEffect, useCallback } from "react";
import {
  Accordion, AccordionSummary, AccordionDetails,
  Button, TextField, Typography, Alert, CircularProgress, Box, Chip, Stack, Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import PageLayout from "../components/PageLayout";
import { getPendingEvents, approveEvent, declineEvent, type Event } from "../api/events";

function formatDate(date: string, time: string | null): string {
  const d = new Date(date + (time ? `T${time}` : "T00:00:00"));
  const dateStr = d.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "long", year: "numeric" });
  if (!time) return dateStr;
  const timeStr = d.toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit", hour12: true });
  return `${dateStr} · ${timeStr}`;
}

function EventReviewCard({ event, onResolved }: { event: Event; onResolved: () => void }) {
  const [declineReason, setDeclineReason] = useState("");
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await approveEvent(event.id);
      onResolved();
    } catch {
      setError("Approval failed. Please try again.");
      setBusy(false);
    }
  }

  async function handleDecline() {
    if (!showDeclineInput) { setShowDeclineInput(true); return; }
    setBusy(true);
    setError(null);
    try {
      await declineEvent(event.id, declineReason || undefined);
      onResolved();
    } catch {
      setError("Decline failed. Please try again.");
      setBusy(false);
    }
  }

  const dateLabel = event.end_date
    ? `${formatDate(event.start_date, event.start_time)} – ${formatDate(event.end_date, event.end_time)}`
    : formatDate(event.start_date, event.start_time);

  return (
    <Accordion disableGutters elevation={0} sx={{ border: "1px solid var(--border)", borderRadius: "6px !important", mb: 2 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", width: "100%" }}>
          <Typography sx={{ fontWeight: 500, flex: 1 }}>{event.title}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
            {new Date(event.start_date + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
          </Typography>
          <Chip label="Pending" size="small" color="warning" />
        </Stack>
      </AccordionSummary>

      <AccordionDetails>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="body2" color="text.secondary">Date</Typography>
            <Typography variant="body1">{dateLabel}</Typography>
          </Box>

          {event.description && (
            <Box>
              <Typography variant="body2" color="text.secondary">Description</Typography>
              <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>{event.description}</Typography>
            </Box>
          )}

          {(event.website || event.phone || event.email) && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>Contact</Typography>
              <Stack spacing={0.5}>
                {event.website && (
                  <Typography variant="body2">
                    <a href={event.website} target="_blank" rel="noopener noreferrer">{event.website}</a>
                  </Typography>
                )}
                {event.phone && <Typography variant="body2">{event.phone}</Typography>}
                {event.email && (
                  <Typography variant="body2">
                    <a href={`mailto:${event.email}`}>{event.email}</a>
                  </Typography>
                )}
              </Stack>
            </Box>
          )}

          {event.hero_image && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>Headline photo</Typography>
              <img
                src={event.hero_image.url}
                alt={event.title}
                style={{ maxWidth: "100%", maxHeight: 260, objectFit: "cover", borderRadius: 4 }}
              />
            </Box>
          )}

          {event.gallery_images.length > 0 && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>Gallery</Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
                {event.gallery_images.map((img) => (
                  <img
                    key={img.file_id}
                    src={img.url}
                    alt=""
                    style={{ width: 100, height: 80, objectFit: "cover", borderRadius: 4 }}
                  />
                ))}
              </Stack>
            </Box>
          )}

          <Box>
            <Typography variant="body2" color="text.secondary">
              Submitted by {event.submitted_by_name} · {new Date(event.submitted_at).toLocaleString("en-NZ")}
            </Typography>
          </Box>

          <Divider />

          {showDeclineInput && (
            <TextField
              label="Reason for declining (optional)"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              fullWidth
              multiline
              minRows={2}
              autoFocus
            />
          )}

          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              color="success"
              startIcon={<CheckIcon />}
              onClick={handleApprove}
              disabled={busy}
            >
              Approve
            </Button>
            <Button
              variant="outlined"
              color="error"
              startIcon={showDeclineInput ? undefined : <CloseIcon />}
              onClick={handleDecline}
              disabled={busy}
            >
              {showDeclineInput ? "Confirm decline" : "Decline"}
            </Button>
            {showDeclineInput && (
              <Button onClick={() => { setShowDeclineInput(false); setDeclineReason(""); }} disabled={busy}>
                Cancel
              </Button>
            )}
          </Stack>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

export default function GovernanceApprovals() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadPending = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    getPendingEvents()
      .then(setEvents)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadPending(); }, [loadPending]);

  return (
    <PageLayout
      pageName="Content approvals"
      showComingSoon={false}
      parents={[{ name: "Governance", path: "/governance" }]}
    >
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        Review events submitted by community members. Approved events are displayed publicly on the Events page.
      </Typography>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load pending events. Please try again later.
        </Alert>
      )}

      {!loading && !loadError && events.length === 0 && (
        <Alert severity="info">No events pending review.</Alert>
      )}

      {!loading && !loadError && events.map((event) => (
        <EventReviewCard
          key={event.id}
          event={event}
          onResolved={() => setEvents((prev) => prev.filter((e) => e.id !== event.id))}
        />
      ))}
    </PageLayout>
  );
}
