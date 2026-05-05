import { useState } from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import { api, type Thread } from "../../api/discussions";

// ── Icons ─────────────────────────────────────────────────────────────────────

const IconEllipsis = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

const IconArchive = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="21 8 21 21 3 21 3 8" />
    <rect x="1" y="3" width="22" height="5" rx="1" />
    <line x1="10" y1="12" x2="14" y2="12" />
  </svg>
);

// ── Shared dialog button styles ───────────────────────────────────────────────

const cancelSx = {
  color: "var(--accent)",
  borderColor: "var(--accent)",
  "&:hover": { borderColor: "var(--accent)", bgcolor: "var(--accent-bg)" },
};

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  thread: Thread;
  currentUserId: string;
  canModerate: boolean;
  onArchived: () => void;
}

export default function ThreadOptionsMenu({ thread, currentUserId, canModerate, onArchived }: Props) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");

  const canArchive = canModerate || thread.created_by_user_id === currentUserId;

  function openMenu(e: React.MouseEvent<HTMLButtonElement>) {
    setMenuAnchor(e.currentTarget);
  }

  function openDialog() {
    setMenuAnchor(null);
    setError("");
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setError("");
  }

  async function handleArchive() {
    setArchiving(true);
    setError("");
    try {
      await api.threads.archive(thread.id);
      setDialogOpen(false);
      onArchived();
    } catch {
      setError("Failed to archive thread. Please try again.");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <>
      <button
        className="discussions-options-btn"
        onClick={openMenu}
        aria-label="Thread options"
        title="Thread options"
      >
        <IconEllipsis />
      </button>

      <Menu
        anchorEl={menuAnchor}
        open={!!menuAnchor}
        onClose={() => setMenuAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <MenuItem onClick={openDialog} sx={{ gap: 1 }}>
          <ListItemIcon sx={{ minWidth: 0, color: "text.secondary" }}>
            <IconArchive />
          </ListItemIcon>
          <ListItemText>Archive thread</ListItemText>
        </MenuItem>
      </Menu>

      <Dialog open={dialogOpen} onClose={closeDialog} maxWidth="xs" fullWidth>
        {canArchive ? (
          <>
            <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
              Archive #{thread.name}?
            </DialogTitle>
            <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
              <DialogContentText>
                This will hide the thread from the list. All messages will be preserved.
              </DialogContentText>
              {error && (
                <DialogContentText color="error" sx={{ mt: 1 }}>{error}</DialogContentText>
              )}
            </DialogContent>
            <DialogActions sx={{ px: 3, pt: 2, pb: 2 }}>
              <Button variant="outlined" sx={cancelSx} onClick={closeDialog} disabled={archiving}>
                Cancel
              </Button>
              <Button
                variant="contained"
                color="error"
                onClick={handleArchive}
                disabled={archiving}
              >
                {archiving ? "Archiving…" : "Archive"}
              </Button>
            </DialogActions>
          </>
        ) : (
          <>
            <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
              Cannot archive thread
            </DialogTitle>
            <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
              <DialogContentText>
                Only <strong>{thread.created_by_name}</strong> or an admin can archive this thread.
              </DialogContentText>
            </DialogContent>
            <DialogActions sx={{ px: 3, pt: 2, pb: 2 }}>
              <Button variant="outlined" sx={cancelSx} onClick={closeDialog}>
                Close
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
