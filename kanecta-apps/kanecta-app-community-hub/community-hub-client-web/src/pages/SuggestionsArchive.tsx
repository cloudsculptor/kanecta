import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Typography, Alert, CircularProgress, Box, Stack } from "@mui/material";
import PageLayout from "../components/PageLayout";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import { useKeycloak } from "../auth/KeycloakProvider";
import { getArchivedSuggestions, type ArchivedSuggestion } from "../api/suggestions";
import { formatNZDateTime } from "../utils/dates";

export default function SuggestionsArchive() {
  const navigate = useNavigate();
  const roles = useUserRoles();
  const { initialized } = useKeycloak();
  const isModerator = hasRole(roles, "moderator");

  const [suggestions, setSuggestions] = useState<ArchivedSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!initialized) return;
    if (!isModerator) { navigate("/governance", { replace: true }); }
  }, [initialized, isModerator, navigate]);

  useEffect(() => {
    getArchivedSuggestions()
      .then(setSuggestions)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageLayout pageName="Suggestions archive" showComingSoon={false}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Suggestions that have been reviewed and archived by a moderator.
      </Typography>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load archived suggestions. Please try again later.
        </Alert>
      )}

      {!loading && !loadError && suggestions.length === 0 && (
        <Alert severity="info">No suggestions have been archived yet.</Alert>
      )}

      {!loading && !loadError && suggestions.map((s) => (
        <Box
          key={s.id}
          sx={{ border: "1px solid var(--border)", borderRadius: "6px", p: 2, mb: 2 }}
        >
          <Typography variant="body1" sx={{ whiteSpace: "pre-wrap", mb: 1 }}>{s.content}</Typography>
          <Stack direction={{ xs: "column", sm: "row" }} sx={{ justifyContent: "space-between", gap: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {s.submitted_by_name ?? "Anonymous"} · {formatNZDateTime(s.submitted_at)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Archived {formatNZDateTime(s.archived_at)}
            </Typography>
          </Stack>
        </Box>
      ))}
    </PageLayout>
  );
}
