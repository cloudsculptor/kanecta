import { useState } from "react";
import { TextField, Stack, Button, Alert, Box } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MarkEmailReadOutlinedIcon from "@mui/icons-material/MarkEmailReadOutlined";
import { submitNotice } from "../../api/notices";
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

export default function NoticeBoardInlineForm({ authenticated, emailVerified, onSubmitted }: Props) {
  const locked = !authenticated || !emailVerified;

  const [heading, setHeading] = useState("");
  const [body, setBody] = useState("");
  const [noticeDate, setNoticeDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function reset() {
    setHeading(""); setBody(""); setNoticeDate("");
    setSubmitting(false); setError(null); setDone(false);
  }

  async function handleSubmit() {
    if (!heading.trim()) { setError("Heading is required"); return; }
    if (heading.trim().length > 120) { setError("Heading must be 120 characters or fewer"); return; }
    if (!body.trim()) { setError("Body text is required"); return; }
    if (body.trim().length > 2000) { setError("Body must be 2000 characters or fewer"); return; }
    if (noticeDate && !nzToIso(noticeDate)) { setError("Enter date as DD/MM/YYYY"); return; }

    setError(null);
    setSubmitting(true);
    try {
      await submitNotice({
        heading: heading.trim(),
        body: body.trim(),
        notice_date: nzToIso(noticeDate) || undefined,
      });
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

  const bodyLen = body.trim().length;
  const bodyHelperText = bodyLen > 2000 ? `Too long — ${bodyLen}/2000` : `${bodyLen}/2000 characters`;

  return (
    <div className="notice-inline-form">
      <h3 className="notice-inline-form__heading">Post a notice</h3>

      <div className="notice-inline-form__wrap">

        {/* ── Auth overlay ─────────────────────────────────────────────── */}
        {locked && (
          <div
            className="notice-inline-form__overlay"
            onClick={() => !authenticated && keycloak.login()}
            role={!authenticated ? "button" : undefined}
            tabIndex={!authenticated ? 0 : undefined}
            onKeyDown={(e) => !authenticated && e.key === "Enter" && keycloak.login()}
          >
            {!authenticated ? (
              <>
                <LockOutlinedIcon sx={{ fontSize: 36, color: "var(--accent)", mb: 1 }} />
                <p className="notice-inline-form__overlay-title">Sign in to post a notice</p>
                <p className="notice-inline-form__overlay-sub">
                  Create a free account or sign in — it only takes a moment.
                </p>
                <Button variant="contained" onClick={(e) => { e.stopPropagation(); keycloak.login(); }}>
                  Sign in or create account
                </Button>
              </>
            ) : (
              <>
                <MarkEmailReadOutlinedIcon sx={{ fontSize: 36, color: "var(--accent)", mb: 1 }} />
                <p className="notice-inline-form__overlay-title">Verify your email to continue</p>
                <p className="notice-inline-form__overlay-sub">
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
              Your notice has been submitted for review. It will appear on this page once a moderator approves it.
            </Alert>
            <Button variant="outlined" onClick={handleDoneReset}>Post another notice</Button>
          </Box>
        ) : (
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Heading"
              required
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              fullWidth
              disabled={locked}
              slotProps={{ htmlInput: { maxLength: 120 } }}
              helperText={`${heading.trim().length}/120`}
            />

            <TextField
              label="Date (optional)"
              value={noticeDate}
              onChange={(e) => setNoticeDate(formatDateInput(e.target.value))}
              placeholder="DD/MM/YYYY"
              slotProps={{ htmlInput: { maxLength: 10 } }}
              error={!!dateError(noticeDate)}
              helperText={dateError(noticeDate)}
              fullWidth
              disabled={locked}
            />

            <TextField
              label="Notice text"
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              fullWidth
              multiline
              minRows={4}
              disabled={locked}
              error={bodyLen > 2000}
              helperText={bodyHelperText}
              slotProps={{ htmlInput: { maxLength: 2000 } }}
            />

            <Box sx={{ pt: 1 }}>
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={locked || submitting}
              >
                {submitting ? "Submitting…" : "Submit notice"}
              </Button>
            </Box>
          </Stack>
        )}
      </div>
    </div>
  );
}
