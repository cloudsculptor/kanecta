import { useState, useEffect, useRef, type ChangeEvent } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Stack, Typography, Button, Alert, Box, IconButton,
  CircularProgress, Divider,
} from "@mui/material";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import DeleteIcon from "@mui/icons-material/Delete";
import {
  getEvent, updateEvent, uploadEventImage, deleteEventImage,
  type Event, type EventSubmitPayload,
} from "../../api/events";
import EventLocationPicker, { type LocationValue } from "./EventLocationPicker";
import { isoToNzInput } from "../../utils/dates";

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

interface ImageSlot {
  file_id: string;
  url: string;
  previewUrl: string;
}

interface Props {
  eventId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function EventEditDialog({ eventId, onClose, onSaved }: Props) {
  const open = eventId !== null;

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasApproved, setWasApproved] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [location, setLocation] = useState<LocationValue | null>(null);
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [organiserName, setOrganiserName] = useState("");
  const [organiserEmail, setOrganiserEmail] = useState("");
  const [organiserPhone, setOrganiserPhone] = useState("");
  const [hero, setHero] = useState<ImageSlot | null>(null);
  const [gallery, setGallery] = useState<ImageSlot[]>([]);
  const [uploadingHero, setUploadingHero] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const heroInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true);
    setError(null);
    getEvent(eventId)
      .then((ev: Event) => {
        setTitle(ev.title);
        setDescription(ev.description ?? "");
        setStartDate(isoToNzInput(ev.start_date));
        setStartTime(ev.start_time ?? "");
        setEndDate(isoToNzInput(ev.end_date));
        setEndTime(ev.end_time ?? "");
        setLocation(
          ev.lat != null && ev.lng != null && ev.address
            ? { address: ev.address, lat: ev.lat, lng: ev.lng }
            : null
        );
        setWebsite(ev.website ?? "");
        setPhone(ev.phone ?? "");
        setEmail(ev.email ?? "");
        setOrganiserName(ev.organiser_name ?? "");
        setOrganiserEmail(ev.organiser_email ?? "");
        setOrganiserPhone(ev.organiser_phone ?? "");
        setHero(ev.hero_image ? { ...ev.hero_image, previewUrl: ev.hero_image.url } : null);
        setGallery((ev.gallery_images ?? []).map((g) => ({ ...g, previewUrl: g.url })));
        setWasApproved(ev.status === "approved");
      })
      .catch(() => setError("Could not load event"))
      .finally(() => setLoading(false));
  }, [eventId]);

  async function handleHeroChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !eventId) return;
    setError(null);
    setUploadingHero(true);
    try {
      const { file_id, url } = await uploadEventImage(eventId, file, "hero");
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
    if (!file || !eventId) return;
    setError(null);
    setUploadingGallery(true);
    try {
      const { file_id, url } = await uploadEventImage(eventId, file, "gallery", gallery.length);
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

  async function handleSave() {
    if (!eventId) return;
    if (!title.trim()) { setError("Title is required"); return; }
    const isoStart = nzToIso(startDate);
    if (!isoStart) { setError("Start date must be in DD/MM/YYYY format"); return; }
    setError(null);
    setSaving(true);
    try {
      const payload: EventSubmitPayload = {
        title: title.trim(),
        description: description.trim() || undefined,
        start_date: isoStart,
        start_time: startTime || undefined,
        end_date: nzToIso(endDate) || undefined,
        end_time: endTime || undefined,
        address: location?.address || undefined,
        lat: location?.lat,
        lng: location?.lng,
        website: website.trim() || undefined,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        organiser_name: organiserName.trim() || undefined,
        organiser_email: organiserEmail.trim() || undefined,
        organiser_phone: organiserPhone.trim() || undefined,
      };
      await updateEvent(eventId, payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit event</DialogTitle>
      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {wasApproved && (
              <Alert severity="info">
                This event is currently approved and publicly visible. Saving changes will resubmit it for moderator review.
              </Alert>
            )}
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Event title" required value={title}
              onChange={(e) => setTitle(e.target.value)} fullWidth
            />
            <TextField
              label="Description" value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth multiline minRows={3}
            />

            <EventLocationPicker value={location} onChange={setLocation} />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Start date" required value={startDate}
                onChange={(e) => setStartDate(formatDateInput(e.target.value))}
                placeholder="DD/MM/YYYY"
                slotProps={{ htmlInput: { maxLength: 10 } }}
                error={!!dateError(startDate)} helperText={dateError(startDate)}
                fullWidth
              />
              <TextField
                label="Start time (optional)" type="time" value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="End date (optional)" value={endDate}
                onChange={(e) => setEndDate(formatDateInput(e.target.value))}
                placeholder="DD/MM/YYYY"
                slotProps={{ htmlInput: { maxLength: 10 } }}
                error={!!dateError(endDate)} helperText={dateError(endDate)}
                fullWidth
              />
              <TextField
                label="End time (optional)" type="time" value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>

            <Divider />
            <Typography variant="subtitle2" color="text.secondary">Organiser contact (not published)</Typography>

            <TextField
              label="Your name" required value={organiserName}
              onChange={(e) => setOrganiserName(e.target.value)} fullWidth
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Your email" required type="email" value={organiserEmail}
                onChange={(e) => setOrganiserEmail(e.target.value)} fullWidth
              />
              <TextField
                label="Your phone" required type="tel" value={organiserPhone}
                onChange={(e) => setOrganiserPhone(e.target.value)} fullWidth
              />
            </Stack>

            <Typography variant="subtitle2" color="text.secondary">Public contact details</Typography>

            <TextField
              label="Website (optional)" type="url" value={website}
              onChange={(e) => setWebsite(e.target.value)}
              fullWidth placeholder="https://"
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Phone (optional)" type="tel" value={phone}
                onChange={(e) => setPhone(e.target.value)} fullWidth
              />
              <TextField
                label="Email (optional)" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} fullWidth
              />
            </Stack>

            <Typography variant="subtitle2" color="text.secondary">Photos</Typography>

            <Box>
              <Typography variant="body2" gutterBottom>Headline photo</Typography>
              {hero ? (
                <Box sx={{ position: "relative", display: "inline-block" }}>
                  <img
                    src={hero.previewUrl} alt="Hero"
                    style={{ width: "100%", maxHeight: 220, objectFit: "cover", borderRadius: 4 }}
                  />
                  <IconButton
                    onClick={handleRemoveHero} size="small"
                    sx={{ position: "absolute", top: 4, right: 4, bgcolor: "rgba(0,0,0,0.5)", color: "#fff" }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ) : (
                <Button
                  variant="outlined" startIcon={<AddPhotoAlternateIcon />}
                  onClick={() => heroInputRef.current?.click()}
                  disabled={uploadingHero} size="small"
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
                      onClick={() => handleRemoveGallery(img.file_id)} size="small"
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
                  variant="outlined" startIcon={<AddPhotoAlternateIcon />}
                  onClick={() => galleryInputRef.current?.click()}
                  disabled={uploadingGallery} size="small"
                >
                  {uploadingGallery ? "Uploading…" : `Add photo (${gallery.length}/3)`}
                </Button>
                <input ref={galleryInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleGalleryChange} />
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={loading || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
