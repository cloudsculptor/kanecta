import { useState, useRef, type ChangeEvent } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Stack, Typography, IconButton, Box, Alert,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import AddPhotoAlternateIcon from "@mui/icons-material/AddPhotoAlternate";
import DeleteIcon from "@mui/icons-material/Delete";
import { submitEvent, uploadEventImage, deleteEventImage } from "../../api/events";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
}

interface ImageSlot {
  file_id: string;
  url: string;
  previewUrl: string;
}

export default function EventSubmitForm({ open, onClose, onSubmitted }: Props) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [website, setWebsite] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
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
    setEndDate(""); setEndTime(""); setWebsite(""); setPhone(""); setEmail("");
    setHero(null); setGallery([]); setEventId(null);
    setSubmitting(false); setUploadingHero(false); setUploadingGallery(false);
    setError(null); setDone(false);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function todayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  async function ensureEventId(): Promise<string> {
    if (eventId) return eventId;
    if (!title.trim()) throw new Error("Please enter a title before uploading images.");
    if (!startDate) throw new Error("Please enter a start date before uploading images.");
    if (startDate < todayIso()) throw new Error("Start date cannot be in the past.");
    const { id } = await submitEvent({
      title: title.trim(),
      description: description.trim() || undefined,
      start_date: startDate,
      start_time: startTime || undefined,
      end_date: endDate || undefined,
      end_time: endTime || undefined,
      website: website.trim() || undefined,
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
    });
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
      const position = gallery.length;
      const { file_id, url } = await uploadEventImage(id, file, "gallery", position);
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
    if (!startDate) { setError("Start date is required"); return; }
    if (startDate < todayIso()) { setError("Start date cannot be in the past"); return; }
    setError(null);
    setSubmitting(true);
    try {
      if (!eventId) {
        await submitEvent({
          title: title.trim(),
          description: description.trim() || undefined,
          start_date: startDate,
          start_time: startTime || undefined,
          end_date: endDate || undefined,
          end_time: endTime || undefined,
          website: website.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
        });
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDoneClose() {
    reset();
    onSubmitted();
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {done ? "Event submitted" : "Submit an event"}
        <IconButton onClick={done ? handleDoneClose : handleClose} size="small">
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {done ? (
          <Box sx={{ py: 2 }}>
            <Alert severity="success">
              Your event has been submitted for review. It will appear on this page once a moderator approves it.
            </Alert>
          </Box>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Event title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
            />

            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              multiline
              minRows={3}
              helperText={`${description.trim().length}/50 characters minimum`}
            />

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Start date"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField
                label="Start time (optional)"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="End date (optional)"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
              <TextField
                label="End time (optional)"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                fullWidth
              />
            </Stack>

            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>
              Contact details
            </Typography>

            <TextField
              label="Website (optional)"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              fullWidth
              placeholder="https://"
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                label="Phone (optional)"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                fullWidth
              />
              <TextField
                label="Email (optional)"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                fullWidth
              />
            </Stack>

            <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1 }}>
              Photos
            </Typography>

            {/* Hero image */}
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
                  disabled={uploadingHero}
                  size="small"
                >
                  {uploadingHero ? "Uploading…" : "Add headline photo"}
                </Button>
              )}
              <input
                ref={heroInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleHeroChange}
              />
            </Box>

            {/* Gallery images */}
            {gallery.length > 0 && (
              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                {gallery.map((img) => (
                  <Box key={img.file_id} sx={{ position: "relative" }}>
                    <img
                      src={img.previewUrl}
                      alt=""
                      style={{ width: 100, height: 80, objectFit: "cover", borderRadius: 4 }}
                    />
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
                  disabled={uploadingGallery}
                  size="small"
                >
                  {uploadingGallery ? "Uploading…" : `Add photo (${gallery.length}/3)`}
                </Button>
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleGalleryChange}
                />
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>

      <DialogActions>
        {done ? (
          <Button onClick={handleDoneClose} variant="contained">Close</Button>
        ) : (
          <>
            <Button onClick={handleClose} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmit} variant="contained" disabled={submitting}>
              {submitting ? "Submitting…" : "Submit event"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
