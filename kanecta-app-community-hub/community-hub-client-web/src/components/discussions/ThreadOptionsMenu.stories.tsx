import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import ThreadOptionsMenu from "./ThreadOptionsMenu";
import type { Thread } from "../../api/discussions";

// ── Shared data ───────────────────────────────────────────────────────────────

const cancelSx = {
  color: "var(--accent)",
  borderColor: "var(--accent)",
  "&:hover": { borderColor: "var(--accent)", bgcolor: "var(--accent-bg)" },
};

const ownThread: Thread = {
  id: "t1", name: "General", description: "Day-to-day chat",
  created_by_name: "Jane Smith", created_by_user_id: "user-1",
  created_at: new Date().toISOString(),
};

const othersThread: Thread = {
  id: "t2", name: "Announcements", description: null,
  created_by_name: "Mike Robinson", created_by_user_id: "user-2",
  created_at: new Date().toISOString(),
};

// ── Fake header wrapper ───────────────────────────────────────────────────────

function ThreadHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "14px 20px", borderBottom: "1px solid var(--border)",
      fontSize: 16, fontWeight: 700, color: "var(--text-h)", maxWidth: 600,
    }}>
      <span style={{ opacity: 0.5 }}>#</span>
      General
      <span style={{ fontSize: 13, fontWeight: 400, opacity: 0.6 }}>Day-to-day chat</span>
      {children}
    </div>
  );
}

// ── Meta ──────────────────────────────────────────────────────────────────────

const meta: Meta<typeof ThreadOptionsMenu> = {
  title: "Discussions/ThreadOptionsMenu",
  component: ThreadOptionsMenu,
  decorators: [(Story) => (
    <div style={{ padding: 40 }}>
      <ThreadHeader><Story /></ThreadHeader>
    </div>
  )],
  args: {
    thread: ownThread,
    currentUserId: "user-1",
    canModerate: false,
    onArchived: () => { console.log("archived"); },
  },
};
export default meta;
type Story = StoryObj<typeof ThreadOptionsMenu>;

/** Ellipsis button visible in the thread header — click to open the menu. */
export const Default: Story = {};

/** Viewing a thread you created — you have permission to archive. */
export const OwnThread: Story = {
  args: { thread: ownThread, currentUserId: "user-1" },
};

/** Moderator viewing someone else's thread — still has permission to archive. */
export const ModeratorOthersThread: Story = {
  args: { thread: othersThread, currentUserId: "user-1", canModerate: true },
};

/** Non-creator, non-moderator — clicking Archive opens the rejection dialog. */
export const OtherUsersThread: Story = {
  args: { thread: othersThread, currentUserId: "user-1", canModerate: false },
};

// ── Dialog states rendered directly ──────────────────────────────────────────

/**
 * Archive confirmation dialog — shown to the thread creator or a moderator.
 * Cancel and Archive buttons are in their final styles.
 */
export const ArchiveConfirmDialog: Story = {
  render: (args) => {
    const [open, setOpen] = useState(true);
    return (
      <>
        <ThreadHeader>
          <ThreadOptionsMenu {...args} />
        </ThreadHeader>
        <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
          <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1.5 }}>
            Archive #{args.thread.name}?
          </DialogTitle>
          <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
            <DialogContentText>
              This will hide the thread from the list. All messages will be preserved.
            </DialogContentText>
          </DialogContent>
          <DialogActions sx={{ px: 3, pt: 2, pb: 2 }}>
            <Button variant="outlined" sx={cancelSx} onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="contained" color="error">Archive</Button>
          </DialogActions>
        </Dialog>
      </>
    );
  },
};

/**
 * Archiving in progress — Archive button shows loading state and both
 * buttons are disabled.
 */
export const ArchivingInProgress: Story = {
  render: (args) => (
    <>
      <ThreadHeader><ThreadOptionsMenu {...args} /></ThreadHeader>
      <Dialog open maxWidth="xs" fullWidth>
        <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1.5 }}>Archive #{args.thread.name}?</DialogTitle>
        <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
          <DialogContentText>
            This will hide the thread from the list. All messages will be preserved.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pt: 2, pb: 2 }}>
          <Button variant="outlined" sx={cancelSx} disabled>Cancel</Button>
          <Button variant="contained" color="error" disabled>Archiving…</Button>
        </DialogActions>
      </Dialog>
    </>
  ),
};

/**
 * Rejection dialog — shown when the current user is neither the thread
 * creator nor a moderator. Displays the creator's name and a Close button.
 */
export const UnauthorizedDialog: Story = {
  args: { thread: othersThread, currentUserId: "user-1", canModerate: false },
  render: (args) => (
    <>
      <ThreadHeader><ThreadOptionsMenu {...args} /></ThreadHeader>
      <Dialog open maxWidth="xs" fullWidth>
        <DialogTitle sx={{ px: 3, pt: 2.5, pb: 1.5 }}>Cannot archive thread</DialogTitle>
        <DialogContent sx={{ px: 3, pt: 1, pb: 0 }}>
          <DialogContentText>
            Only <strong>{args.thread.created_by_name}</strong> or an admin can archive this thread.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pt: 2, pb: 2 }}>
          <Button variant="outlined" sx={cancelSx}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  ),
};
