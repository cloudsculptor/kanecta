import { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import CircularProgress from "@mui/material/CircularProgress";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import PageLayout from "../components/PageLayout";
import { pushApi } from "../api/push";
import { usePushDevice } from "../hooks/usePushDevice";

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
      </Box>
    </PageLayout>
  );
}
