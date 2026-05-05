import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Box from "@mui/material/Box";
import { DuplicateThreadError, type Thread } from "../../api/discussions";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description?: string) => Promise<void>;
  onGoToThread?: (threadId: string) => void;
}

export default function CreateThreadModal({ open, onClose, onCreate, onGoToThread }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [duplicate, setDuplicate] = useState<Thread | null>(null);

  function handleNameChange(value: string) {
    setName(value);
    if (duplicate) setDuplicate(null);
    if (error) setError("");
  }

  async function handleCreate() {
    if (!name.trim()) { setError("Thread name is required"); return; }
    setSaving(true);
    setError("");
    setDuplicate(null);
    try {
      await onCreate(name.trim(), description.trim() || undefined);
      setName(""); setDescription("");
      onClose();
    } catch (err) {
      if (err instanceof DuplicateThreadError) {
        setDuplicate(err.existing);
      } else {
        setError("Failed to create thread. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  function handleGoToThread() {
    if (!duplicate) return;
    onGoToThread?.(duplicate.id);
    setName(""); setDescription(""); setDuplicate(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1.5 }}>New Thread</DialogTitle>
      <DialogContent sx={{ px: 3, pt: 0, pb: 0 }}>
        <TextField
          autoFocus fullWidth label="Thread name" value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          error={!!error} helperText={error}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth label="Description (optional)" value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline rows={2}
        />
        {duplicate && (
          <Box sx={{ mt: 2, p: 1.5, borderRadius: 1, border: "1px solid", borderColor: "warning.main", bgcolor: "warning.50" }}>
            <Box sx={{ fontSize: 13, color: "warning.dark", mb: onGoToThread ? 1 : 0 }}>
              A thread named <strong>#{duplicate.name}</strong> already exists.
              {duplicate.description && (
                <Box component="span" sx={{ color: "text.secondary" }}> — {duplicate.description}</Box>
              )}
            </Box>
            {onGoToThread && (
              <Button size="small" variant="outlined" color="warning" onClick={handleGoToThread}>
                Go to #{duplicate.name}
              </Button>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pt: 2, pb: 2 }}>
        <Button
          onClick={onClose}
          disabled={saving}
          variant="outlined"
          sx={{
            color: "var(--accent)",
            borderColor: "var(--accent)",
            "&:hover": { borderColor: "var(--accent)", bgcolor: "var(--accent-bg)" },
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleCreate}
          variant="contained"
          disabled={saving}
          sx={{
            bgcolor: "var(--accent)",
            boxShadow: "none",
            "&:hover": { bgcolor: "#2d6a35", boxShadow: "none" },
            "&:disabled": { bgcolor: "var(--accent-border)" },
          }}
        >
          {saving ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
