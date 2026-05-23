import { useState } from "react";
import { Link } from "react-router-dom";
import { TextField, Stack, Button, Alert, Box } from "@mui/material";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import MarkEmailReadOutlinedIcon from "@mui/icons-material/MarkEmailReadOutlined";
import { submitSuggestion } from "../api/suggestions";
import keycloak from "../auth/keycloak";

const MAX_CHARS = 2000;

interface Props {
  authenticated: boolean;
  emailVerified: boolean;
}

export default function ContributeForm({ authenticated, emailVerified }: Props) {
  const locked = !authenticated || !emailVerified;
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitSuggestion(content.trim());
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="contribute-form">
      <p className="contribute-form__blurb">
        Want to help shape this site? Suggest new features or categories, add content, get involved
        in site governance, or <Link to="/volunteering">become a volunteer contributor</Link>.
        Your message goes directly to the team.
      </p>
      <div className="contribute-form__wrap">
        {locked && (
          <div
            className="contribute-form__overlay"
            onClick={() => !authenticated && keycloak.login()}
            role={!authenticated ? "button" : undefined}
            tabIndex={!authenticated ? 0 : undefined}
            onKeyDown={(e) => !authenticated && e.key === "Enter" && keycloak.login()}
          >
            {!authenticated ? (
              <>
                <LockOutlinedIcon sx={{ fontSize: 36, color: "var(--accent)", mb: 1 }} />
                <p className="contribute-form__overlay-title">Sign in to contribute</p>
                <p className="contribute-form__overlay-sub">
                  Create a free account or sign in — it only takes a moment.
                </p>
                <Button variant="contained" onClick={(e) => { e.stopPropagation(); keycloak.login(); }}>
                  Sign in or create account
                </Button>
              </>
            ) : (
              <>
                <MarkEmailReadOutlinedIcon sx={{ fontSize: 36, color: "var(--accent)", mb: 1 }} />
                <p className="contribute-form__overlay-title">Verify your email to continue</p>
                <p className="contribute-form__overlay-sub">
                  Check your inbox for a verification link, then refresh this page.
                </p>
              </>
            )}
          </div>
        )}

        {done ? (
          <Box sx={{ py: 4, textAlign: "center" }}>
            <Alert severity="success">Thanks — your suggestion has been sent to the team.</Alert>
            <Button variant="outlined" sx={{ mt: 2 }} onClick={() => { setContent(""); setDone(false); }}>
              Submit another
            </Button>
          </Box>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack spacing={2}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField
                label="Your suggestion or message"
                multiline
                minRows={5}
                fullWidth
                value={content}
                onChange={(e) => setContent(e.target.value.slice(0, MAX_CHARS))}
                disabled={locked}
                helperText={`${content.length} / ${MAX_CHARS}`}
                slotProps={{ formHelperText: { sx: { textAlign: "right" } } }}
              />
              <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={locked || submitting || !content.trim()}
                >
                  Send suggestion
                </Button>
              </Box>
            </Stack>
          </form>
        )}
      </div>
    </div>
  );
}
