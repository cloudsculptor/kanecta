import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box,
} from '@mui/material';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Body currently stored in function.json on disk */
  diskBody: string;
  /** Body currently in the edit form */
  formBody: string;
  /** Use the form body — overwrite disk */
  onUseForm: () => void;
  /** Use the disk body — update the form and discard in-memory edits */
  onUseDisk: () => void;
}

const codeStyle = {
  fontFamily: 'monospace',
  fontSize: '0.8rem',
  whiteSpace: 'pre' as const,
  overflowX: 'auto' as const,
  p: 1.5,
  bgcolor: 'background.default',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
  flex: 1,
  minHeight: 200,
  maxHeight: 400,
  overflow: 'auto',
};

export function BodyConflictDialog({ open, onClose, diskBody, formBody, onUseForm, onUseDisk }: Props) {
  return (
    <Dialog open={open} onClose={onClose} onClick={(e) => e.stopPropagation()} maxWidth="lg" fullWidth>
      <DialogTitle>
        Body conflict
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          The body on disk differs from what is in the form. Choose which version to keep.
        </Typography>
      </DialogTitle>

      <DialogContent sx={{ pt: '12px !important' }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          {/* Disk panel */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              On disk — function.json
            </Typography>
            <Box sx={codeStyle}>
              {diskBody || <Typography component="span" sx={{ fontStyle: 'italic', color: 'text.disabled' }}>empty</Typography>}
            </Box>
            <Button
              variant="outlined"
              size="small"
              fullWidth
              sx={{ mt: 1 }}
              onClick={onUseDisk}
            >
              Use disk — restore to form
            </Button>
          </Box>

          {/* Form panel */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              In memory — form
            </Typography>
            <Box sx={codeStyle}>
              {formBody || <Typography component="span" sx={{ fontStyle: 'italic', color: 'text.disabled' }}>empty</Typography>}
            </Box>
            <Button
              variant="contained"
              size="small"
              fullWidth
              sx={{ mt: 1 }}
              onClick={onUseForm}
            >
              Use mine — save to disk
            </Button>
          </Box>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
