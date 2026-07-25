import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import PageLayout from "../components/PageLayout";
import { pushApi } from "../api/push";
import { usePushDevice } from "../hooks/usePushDevice";
import { accountApi, type UpcomingEvent } from "../api/account";
import keycloak from "../auth/keycloak";

type Prefs = { events: boolean; discussions: boolean; suggestions: boolean; pages: boolean };

const LABELS: Record<keyof Prefs, string> = {
  events: "Events — new event submissions",
  discussions: "Discussions — new threads",
  suggestions: "Suggestions — new suggestions from members",
  pages: "Pages — newly published pages",
};

export default function Settings() {
  const { status, subscribe, unsubscribe } = usePushDevice();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletePreviewLoading, setDeletePreviewLoading] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<UpcomingEvent[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isSubscribed = status === "subscribed";

  useEffect(() => {
    if (isSubscribed) {
      pushApi.getPreferences().then(setPrefs).catch(() => setError("Could not load preferences"));
    }
  }, [isSubscribed]);

  async function handleGlobalToggle() {
    setError(null);
    try {
      if (isSubscribed) {
        await unsubscribe();
        setPrefs(null);
      } else {
        await subscribe();
      }
    } catch {
      setError("Could not update notification setting");
    }
  }

  async function handlePrefToggle(key: keyof Prefs) {
    if (!prefs) return;
    const updated = { ...prefs, [key]: !prefs[key] };
    setPrefs(updated);
    setSaving(true);
    try {
      await pushApi.savePreferences({ [key]: updated[key] });
    } catch {
      setPrefs(prefs);
      setError("Could not save preference");
    } finally {
      setSaving(false);
    }
  }

  async function openDeleteDialog() {
    setDeleteError(null);
    setDeleteDialogOpen(true);
    setDeletePreviewLoading(true);
    try {
      const { upcomingEvents } = await accountApi.getDeletionPreview();
      setUpcomingEvents(upcomingEvents);
    } catch {
      setDeleteError("Could not check your upcoming events. You can still continue.");
    } finally {
      setDeletePreviewLoading(false);
    }
  }

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError(null);
    try {
      await accountApi.deleteAccount();
      keycloak.logout({ redirectUri: window.location.origin });
    } catch {
      setDeleteError("Could not delete your account. Please try again or contact us.");
      setDeleting(false);
    }
  }

  return (
    <PageLayout pageName="Settings" showComingSoon={false}>
      <Box sx={{ maxWidth: 480, py: 2 }}>
        <Typography variant="h6" gutterBottom>Notifications</Typography>

        {status === "unsupported" && (
          <Alert severity="info">Push notifications are not supported on this device.</Alert>
        )}
        {status === "denied" && (
          <Alert severity="warning">Notifications are blocked. Enable them in your device settings to receive alerts.</Alert>
        )}

        {status !== "unsupported" && (
          <>
            <FormControlLabel
              control={
                <Switch
                  checked={isSubscribed}
                  onChange={handleGlobalToggle}
                  disabled={status === "denied"}
                />
              }
              label="Enable push notifications"
            />

            {isSubscribed && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Notify me about:
                </Typography>
                {prefs === null ? (
                  <CircularProgress size={20} />
                ) : (
                  Object.entries(LABELS).map(([key, label]) => (
                    <Box key={key} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 0.5 }}>
                      <Typography variant="body2">{label}</Typography>
                      <Switch
                        size="small"
                        checked={prefs[key as keyof Prefs]}
                        onChange={() => handlePrefToggle(key as keyof Prefs)}
                        disabled={saving}
                      />
                    </Box>
                  ))
                )}
              </>
            )}
          </>
        )}

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}

        <Divider sx={{ my: 3 }} />

        <Typography variant="h6" gutterBottom>Danger zone</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Deleting your account removes your login for good. Your past messages, notices, and other
          posts stay on the site so other members' conversations aren't broken, but your name is
          replaced with "Former member".
        </Typography>
        <Button variant="outlined" color="error" onClick={openDeleteDialog}>
          Delete my account
        </Button>
      </Box>

      <Dialog open={deleteDialogOpen} onClose={() => !deleting && setDeleteDialogOpen(false)}>
        <DialogTitle>Delete your account?</DialogTitle>
        <DialogContent>
          {deletePreviewLoading ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 1 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">Checking your upcoming events…</Typography>
            </Box>
          ) : upcomingEvents.length > 0 ? (
            <>
              <Alert severity="warning" sx={{ mb: 1.5 }}>
                You have {upcomingEvents.length} upcoming event{upcomingEvents.length > 1 ? "s" : ""} on
                the site. Since nobody could follow up with you afterwards, {upcomingEvents.length > 1 ? "these" : "it"} will
                be deleted along with your account:
              </Alert>
              <List dense>
                {upcomingEvents.map((event) => (
                  <ListItem key={event.id} disablePadding sx={{ pl: 1 }}>
                    <ListItemText primary={event.title} secondary={event.start_date} />
                  </ListItem>
                ))}
              </List>
            </>
          ) : (
            <Typography variant="body2">
              This can't be undone — you'll be signed out and won't be able to log back in.
            </Typography>
          )}

          {deleteError && <Alert severity="error" sx={{ mt: 1.5 }}>{deleteError}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={handleDeleteAccount}
            disabled={deleting || deletePreviewLoading}
          >
            {deleting ? "Deleting…" : "Delete my account"}
          </Button>
        </DialogActions>
      </Dialog>
    </PageLayout>
  );
}
