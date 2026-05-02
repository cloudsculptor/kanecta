import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description?: string) => Promise<void>;
}

export default function CreateThreadModal({ open, onClose, onCreate }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleCreate() {
    if (!name.trim()) { setError("Thread name is required"); return; }
    setSaving(true);
    setError("");
    try {
      await onCreate(name.trim(), description.trim() || undefined);
      setName(""); setDescription("");
      onClose();
    } catch {
      setError("Failed to create thread. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>New Thread</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus fullWidth label="Thread name" value={name}
          onChange={(e) => setName(e.target.value)}
          error={!!error} helperText={error}
          onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
          sx={{ mt: 1, mb: 2 }}
        />
        <TextField
          fullWidth label="Description (optional)" value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline rows={2}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={handleCreate} variant="contained" disabled={saving}>
          {saving ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
