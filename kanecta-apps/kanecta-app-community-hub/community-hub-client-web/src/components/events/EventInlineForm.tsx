import { useState, useRef, type ChangeEvent } from "react";
import {
  TextField, Stack, Typography, Button, Alert, Box, IconButton,
  FormControlLabel, Checkbox,
} from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import DeleteIcon from "@mui/icons-material/Delete";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MarkEmailReadOutlinedIcon from "@mui/icons-material/MarkEmailReadOutlined";
import { submitEvent, uploadEventImage, deleteEventImage } from "../../api/events";
import EventLocationPicker, { type LocationValue } from "./EventLocationPicker";
import keycloak from "../../auth/keycloak";

function formatDateInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function nzToIso(nz: string): string {
  const match = nz.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return "";
  const [, d, m, y] = match;
  const date = new Date(`${y}-${m}-${d}`);
  if (isNaN(date.getTime())) return "";
  return `${y}-${m}-${d}`;
}

function dateError(nz: string): string | undefined {
  if (!nz || nz.length < 10) return undefined;
  if (!nzToIso(nz)) return "Enter a valid date as DD/MM/YYYY";
  return undefined;
}

interface Props {
  authenticated: boolean;
  emailVerified: boolean;
  onSubmitted: () => void;
}

interface ImageSlot {
  file_id: string;
  url: string;
  previewUrl: string;
}

export default function EventInlineForm({ authenticated, emailVerified, onSubmitted }: Props) {
  const locked = !authenticated || !emailVerified;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [website, setWebsite] = useState("");
  const [publicPhone, setPublicPhone] = useState("");
  const [publicEmail, setPublicEmail] = useState("");
  const [organiserName, setOrganiserName] = useState(keycloak.tokenParsed?.name as string ?? "");
  const [organiserEmail, setOrganiserEmail] = useState(keycloak.tokenParsed?.email as string ?? "");
  const [organiserPhone, setOrganiserPhone] = useState("");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [hero, setHero] = useState<ImageSlot | null>(null);
  const [gallery, setGallery] = useState<ImageSlot[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const heroInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setTitle(""); setDescription(""); setStartDate(""); setStartTime("");
    setEndDate(""); setEndTime(""); setLocation(null);
    setWebsite(""); setPublicPhone(""); setPublicEmail("");
    setOrganiserName(keycloak.tokenParsed?.name as string ?? "");
    setOrganiserEmail(keycloak.tokenParsed?.email as string ?? "");
    setOrganiserPhone("");
    setPermissionConfirmed(false);
    setHero(null); setGallery([]); setEventId(null);
    setSubmitting(false); setUploadingHero(false); setUploadingGallery(false);
    setError(null); setDone(false);
  }

  function buildPayload() {
    return {
      title: title.trim(),
      description: description.trim() || undefined,
      start_date: nzToIso(startDate),
      start_time: startTime || undefined,
      end_date: nzToIso(endDate) || undefined,
      end_time: endTime || undefined,
      address: location?.address || undefined,
      lat: location?.lat,
      lng: location?.lng,
      website: website.trim() || undefined,
      phone: publicPhone.trim() || undefined,
      email: publicEmail.trim() || undefined,
      organiser_name: organiserName.trim() || undefined,
      organiser_email: organiserEmail.trim() || undefined,
      organiser_phone: organiserPhone.trim() || undefined,
    };
  }

  async function ensureEventId(): Promise<string> {
    if (eventId) return eventId;
    if (!title.trim()) throw new Error("Please enter a title before uploading images.");
    const isoStart = nzToIso(startDate);
    if (!isoStart) throw new Error("Please enter a valid start date (DD/MM/YYYY) before uploading images.");
    const { id } = await submitEvent(buildPayload());
    setEventId(id);
    return id;
  }

  async function handleHeroChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingHero(true);
    try {
      const id = await ensureEventId();
      const { file_id, url } = await uploadEventImage(id, file, "hero");
      setHero({ file_id, url, previewUrl: URL.createObjectURL(file) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingHero(false);
      if (heroInputRef.current) heroInputRef.current.value = "";
    }
  }

  async function handleGalleryChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploadingGallery(true);
    try {
      const id = await ensureEventId();
      const { file_id, url } = await uploadEventImage(id, file, "gallery", gallery.length);
      setGallery((prev) => [...prev, { file_id, url, previewUrl: URL.createObjectURL(file) }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingGallery(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  }

  async function handleRemoveHero() {
    if (!eventId || !hero) return;
    try {
      await deleteEventImage(eventId, hero.file_id);
      setHero(null);
    } catch {
      setError("Could not remove image");
    }
  }

  async function handleRemoveGallery(fileId: string) {
    if (!eventId) return;
    try {
      await deleteEventImage(eventId, fileId);
      setGallery((prev) => prev.filter((g) => g.file_id !== fileId));
    } catch {
      setError("Could not remove image");
    }
  }

  async function handleSubmit() {
    if (!title.trim()) { setError("Title is required"); return; }
    const desc = description.trim();
    if (desc.length < 50) { setError("Description must be at least 50 characters"); return; }
    if (desc.length > 1000) { setError("Description must be 1000 characters or fewer"); return; }
    const isoStart = nzToIso(startDate);
    if (!isoStart) { setError("Start date must be in DD/MM/YYYY format"); return; }
    if (!organiserName.trim()) { setError("Organiser name is required"); return; }
    if (!organiserEmail.trim()) { setError("Organiser email is required"); return; }
    if (!organiserPhone.trim()) { setError("Organiser phone is required"); return; }
    if (!permissionConfirmed) { setError("Please confirm you have permission to post this event"); return; }
    setError(null);
    setSubmitting(true);
    try {
      if (!eventId) {
        await submitEvent(buildPayload());
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDoneReset() {
    reset();
    onSubmitted();
  }

  const descLen = description.trim().length;
  const descError = descLen > 0 && descLen < 50
    ? `At least 50 characters required (${descLen}/50)`
    : descLen > 1000
    ? `Too long — ${descLen}/1000`
    : undefined;

  return (
    <div className="event-inline-form">
      <h3 className="event-inline-form__heading">Submit an event</h3>

      <div className="event-inline-form__wrap">

        {/* ── Auth overlay ─────────────────────────────────────────────── */}
        {locked && (
          <div
            className="event-inline-form__overlay"
            onClick={() => !authenticated && keycloak.login()}
            role={!authenticated ? "button" : undefined}
            tabIndex={!authenticated ? 0 : undefined}
            onKeyDown={(e) => !authenticated && e.key === "Enter" && keycloak.login()}
          >
            {!authenticated ? (
              <>
                <LockOutlinedIcon sx={{ fontSize: 36, color: "var(--accent)", mb: 1 }} />
                <p className="event-inline-form__overlay-title">Sign in to submit an event</p>
                <p className="event-inline-form__overlay-sub">
                  Create a free account or sign in — it only takes a moment.
                </p>
                <Button variant="contained" onClick={(e) => { e.stopPropagation(); keycloak.login(); }}>
                  Sign in or create account
                </Button>
              </>
            ) : (
              <>
                <MarkEmailReadOutlinedIcon sx={{ fontSize: 36, color: "var(--accent)", mb: 1 }} />
                <p className="event-inline-form__overlay-title">Verify your email to continue</p>
                <p className="event-inline-form__overlay-sub">
                  Check your inbox for a verification link, then refresh this page.
                </p>
              </>
            )}
          </div>
        )}

        {/* ── Form fields ──────────────────────────────────────────────── */}
        {done ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Alert severity="success" sx={{ mb: 2 }}>
              Your event has been submitted for review. It will appear on this page once a moderator approves it.
            </Alert>
            <Button variant="outlined" onClick={handleDoneReset}>Submit another event</Button>
          </Box>
        ) : (
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Event title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              disabled={locked}
            />

            <TextField
              label="Description"
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              minRows={4}
              disabled={locked}
              error={!!descError}
              helperText={descError ?? `${descLen}/1000 characters (minimum 50)`}
              slotProps={{ htmlInput: { maxLength: 1000 } }}
            />

            <EventLocationPicker
              value={location}
              onChange={setLocation}
              disabled={locked}
            />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Start date"
                required
                value={startDate}
                onChange={(e) => setStartDate(formatDateInput(e.target.value))}
                placeholder="DD/MM/YYYY"
                slotProps={{ htmlInput: { maxLength: 10 } }}
                error={!!dateError(startDate)}
                helperText={dateError(startDate)}
                fullWidth
                disabled={locked}
              />
              <TextField
                label="Start time (optional)"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
                disabled={locked}
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="End date (optional)"
                value={endDate}
                onChange={(e) => setEndDate(formatDateInput(e.target.value))}
                placeholder="DD/MM/YYYY"
                slotProps={{ htmlInput: { maxLength: 10 } }}
                error={!!dateError(endDate)}
                helperText={dateError(endDate)}
                fullWidth
                disabled={locked}
              />
              <TextField
                label="End time (optional)"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
                disabled={locked}
              />
            </Stack>

            {/* ── Organiser contact (private) ──────────────────────────── */}
            <Typography variant="subtitle2" color="text.secondary">
              Organiser contact details
            </Typography>
            <Alert severity="info" sx={{ py: 0.5 }}>
              These details are for moderation purposes only and will not be published.
            </Alert>

            <TextField
              label="Your name"
              required
              value={organiserName}
              onChange={(e) => setOrganiserName(e.target.value)}
              fullWidth
              disabled={locked}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Your email"
                required
                type="email"
                value={organiserEmail}
                onChange={(e) => setOrganiserEmail(e.target.value)}
                fullWidth
                disabled={locked}
              />
              <TextField
                label="Your phone"
                required
                type="tel"
                value={organiserPhone}
                onChange={(e) => setOrganiserPhone(e.target.value)}
                fullWidth
                disabled={locked}
              />
            </Stack>

            {/* ── Public contact details ───────────────────────────────── */}
            <Typography variant="subtitle2" color="text.secondary">
              Public contact details
            </Typography>
            <Alert severity="info" sx={{ py: 0.5 }}>
              These details will be shown on the public event listing.
            </Alert>

            <TextField
              label="Website (optional)"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              fullWidth
              placeholder="https://"
              disabled={locked}
            />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Phone (optional)"
                type="tel"
                value={publicPhone}
                onChange={(e) => setPublicPhone(e.target.value)}
                fullWidth
                disabled={locked}
              />
              <TextField
                label="Email (optional)"
                type="email"
                value={publicEmail}
                onChange={(e) => setPublicEmail(e.target.value)}
                fullWidth
                disabled={locked}
              />
            </Stack>

            {/* ── Photos ───────────────────────────────────────────────── */}
            <Typography variant="subtitle2" color="text.secondary">Photos</Typography>

            <Box>
              <Typography variant="body2" gutterBottom>Headline photo</Typography>
              {hero ? (
                <Box sx={{ position: "relative", display: "inline-block" }}>
                  <img
                    src={hero.previewUrl}
                    alt="Hero"
                    style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 4 }}
                  />
                  <IconButton
                    onClick={handleRemoveHero}
                    size="small"
                    sx={{ position: "absolute", top: 4, right: 4, bgcolor: "rgba(0,0,0,0.5)", color: "#fff" }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : (
                <Button
                  variant="outlined"
                  startIcon={<AddPhotoAlternateIcon />}
                  onClick={() => heroInputRef.current?.click()}
                  disabled={locked || uploadingHero}
                  size="small"
                >
                  {uploadingHero ? "Uploading…" : "Add headline photo"}
                </Button>
              )}
              <input ref={heroInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleHeroChange} />
            </Box>

            {gallery.length > 0 && (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {gallery.map((img) => (
                  <Box key={img.file_id} sx={{ position: "relative" }}>
                    <img src={img.previewUrl} alt="" style={{ width: 100, height: 80, objectFit: "cover", borderRadius: 4 }} />
                    <IconButton
                      onClick={() => handleRemoveGallery(img.file_id)}
                      size="small"
                      sx={{ position: "absolute", top: 2, right: 2, bgcolor: "rgba(0,0,0,0.5)", color: "#fff" }}
                    >
                      <DeleteIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                ))}
              </Box>
            )}

            {gallery.length < 3 && (
              <Box>
                <Button
                  variant="outlined"
                  startIcon={<AddPhotoAlternateIcon />}
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={locked || uploadingGallery}
                  size="small"
                >
                  {uploadingGallery ? "Uploading…" : `Add photo (${gallery.length}/3)`}
                </Button>
                <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleGalleryChange} />
              </Box>
            )}

            {/* ── Permission checkbox ──────────────────────────────────── */}
            <FormControlLabel
              control={
                <Checkbox
                  checked={permissionConfirmed}
                  onChange={(e) => setPermissionConfirmed(e.target.checked)}
                  disabled={locked}
                />
              }
              label="I am one of the organisers, or I have the organiser's permission to post this event."
            />

            <Box sx={{ pt: 1 }}>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={locked || submitting || !permissionConfirmed}
              >
                {submitting ? "Submitting…" : "Submit event"}
              </Button>
            </Box>
          </Stack>
        )}
      </div>
    </div>
  );
}
