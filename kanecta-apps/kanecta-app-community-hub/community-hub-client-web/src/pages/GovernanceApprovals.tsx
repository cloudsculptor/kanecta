import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Accordion, AccordionSummary, AccordionDetails,
  Button, TextField, Typography, Alert, CircularProgress, Box, Chip, Stack, Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import PageLayout from "../components/PageLayout";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getPendingEvents, approveEvent, declineEvent, type Event } from "../api/events";
import { getSuggestions, type Suggestion } from "../api/suggestions";
import { getPendingNotices, approveNotice, declineNotice, type Notice } from "../api/notices";

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

function NoticeReviewCard({ notice, onResolved }: { notice: Notice; onResolved: () => void }) {
  const [declineReason, setDeclineReason] = useState("");
  const [showDeclineInput, setShowDeclineInput] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleApprove() {
    setBusy(true);
    setError(null);
    try {
      await approveNotice(notice.id);
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
      await declineNotice(notice.id, declineReason || undefined);
      onResolved();
    } catch {
      setError("Decline failed. Please try again.");
      setBusy(false);
    }
  }

  return (
    <Accordion disableGutters elevation={0} sx={{ border: "1px solid var(--border)", borderRadius: "6px !important", mb: 2 }}>
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Stack direction="row" spacing={2} sx={{ alignItems: "center", width: "100%" }}>
          <Typography sx={{ fontWeight: 500, flex: 1 }}>{notice.heading}</Typography>
          {notice.notice_date && (
            <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>
              {new Date(notice.notice_date + "T00:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short", year: "numeric" })}
            </Typography>
          )}
          <Chip label="Pending" size="small" color="warning" />
        </Stack>
      </AccordionSummary>

      <AccordionDetails>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="body2" color="text.secondary">Notice text</Typography>
            <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {notice.body}
            </Typography>
          </Box>

          <Box>
            <Typography variant="body2" color="text.secondary">
              Submitted by {notice.submitted_by_name} · {new Date(notice.submitted_at).toLocaleString("en-NZ")}
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
  const navigate = useNavigate();
  const roles = useUserRoles();
  const { initialized } = useKeycloak();
  const isModerator = hasRole(roles, "moderator");

  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(true);
  const [suggestionsError, setSuggestionsError] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [noticesLoading, setNoticesLoading] = useState(true);
  const [noticesError, setNoticesError] = useState(false);

  useEffect(() => {
    if (!initialized) return;
    if (!isModerator) { navigate("/governance", { replace: true }); }
  }, [initialized, isModerator, navigate]);

  const loadPending = useCallback(() => {
    setEventsLoading(true);
    setEventsError(false);
    getPendingEvents()
      .then(setEvents)
      .catch(() => setEventsError(true))
      .finally(() => setEventsLoading(false));
  }, []);

  useEffect(() => { loadPending(); }, [loadPending]);

  useEffect(() => {
    getSuggestions()
      .then(setSuggestions)
      .catch(() => setSuggestionsError(true))
      .finally(() => setSuggestionsLoading(false));
  }, []);

  useEffect(() => {
    getPendingNotices()
      .then(setNotices)
      .catch(() => setNoticesError(true))
      .finally(() => setNoticesLoading(false));
  }, []);

  return (
    <PageLayout
      pageName="Content approvals"
      showComingSoon={false}
    >
      <Typography variant="h6" sx={{ mb: 1 }}>Pending events</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Approved events are displayed publicly on the Events page.
      </Typography>

      {eventsLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {eventsError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load pending events. Please try again later.
        </Alert>
      )}

      {!eventsLoading && !eventsError && events.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>No events pending review.</Alert>
      )}

      {!eventsLoading && !eventsError && events.map((event) => (
        <EventReviewCard
          key={event.id}
          event={event}
          onResolved={() => setEvents((prev) => prev.filter((e) => e.id !== event.id))}
        />
      ))}

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" sx={{ mb: 1 }}>Suggestions from the community</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Messages submitted via the "Contribute to this site" form on the home page.
      </Typography>

      {suggestionsLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {suggestionsError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load suggestions. Please try again later.
        </Alert>
      )}

      {!suggestionsLoading && !suggestionsError && suggestions.length === 0 && (
        <Alert severity="info">No suggestions yet.</Alert>
      )}

      {!suggestionsLoading && !suggestionsError && suggestions.map((s) => (
        <Box
          key={s.id}
          sx={{
            border: "1px solid var(--border)",
            borderRadius: "6px",
            p: 2,
            mb: 2,
          }}
        >
          <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>{s.content}</Typography>
          <Typography variant="body2" color="text.secondary">
            {s.submitted_by_name ?? "Anonymous"} · {new Date(s.submitted_at).toLocaleString("en-NZ")}
          </Typography>
        </Box>
      ))}

      <Divider sx={{ my: 4 }} />

      <Typography variant="h6" sx={{ mb: 1 }}>Pending notices</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Notices submitted via the Community Notice Board page.
      </Typography>

      {noticesLoading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {noticesError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load pending notices. Please try again later.
        </Alert>
      )}

      {!noticesLoading && !noticesError && notices.length === 0 && (
        <Alert severity="info">No notices pending review.</Alert>
      )}

      {!noticesLoading && !noticesError && notices.map((notice) => (
        <NoticeReviewCard
          key={notice.id}
          notice={notice}
          onResolved={() => setNotices((prev) => prev.filter((n) => n.id !== notice.id))}
        />
      ))}
    </PageLayout>
  );
}
