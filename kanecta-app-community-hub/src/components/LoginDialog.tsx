import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

const items = [
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        width="24"
        height="24"
        aria-hidden="true"
      >
        <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
      </svg>
    ),
    color: "#aa3bff",
    text: "Ability to create an account so you can post information in the categories, join groups and contribute directly.",
  },
  {
    icon: (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        width="24"
        height="24"
        aria-hidden="true"
      >
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
      </svg>
    ),
    color: "#2e7d32",
    text: "Ability to become verified by the community as a trusted, real world person or organisation.",
  },
];

export default function LoginDialog({ open, onClose }: LoginDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Sign up &amp; Login</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>Coming soon:</DialogContentText>
        <List disablePadding>
          {items.map(({ icon, color, text }) => (
            <ListItem key={text} alignItems="flex-start" sx={{ px: 0, py: 1 }}>
              <ListItemIcon sx={{ minWidth: 44, color, mt: 0.25 }}>
                {icon}
              </ListItemIcon>
              <ListItemText primary={text} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
