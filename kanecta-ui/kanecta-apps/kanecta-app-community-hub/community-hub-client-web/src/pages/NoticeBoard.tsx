import { useState, useEffect, useCallback } from "react";
import {
  Typography, Alert, CircularProgress, Box, Chip, Button,
} from "@mui/material";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import PageLayout from "../components/PageLayout";
import NoticeCard from "../components/notices/NoticeCard";
import NoticeBoardInlineForm from "../components/notices/NoticeBoardInlineForm";
import { getNotices, getMyNotices, deleteNotice, type Notice, type MyNotice } from "../api/notices";
import { useKeycloak } from "../auth/KeycloakProvider";
import keycloak from "../auth/keycloak";
import { formatNZDate } from "../utils/dates";

const STATUS_CHIP: Record<MyNotice["status"], { label: string; color: "warning" | "success" | "error" }> = {
  pending:  { label: "Pending review", color: "warning" },
  approved: { label: "Approved",       color: "success" },
  declined: { label: "Declined",       color: "error"   },
};


function MyNoticeRow({ notice, onDeleted }: { notice: MyNotice; onDeleted: () => void }) {
  const chip = STATUS_CHIP[notice.status];
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDelete() {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    try {
      await deleteNotice(notice.id);
      onDeleted();
    } catch {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="my-notice-row">
      <div className="my-notice-row__main">
        <span className="my-notice-row__title">{notice.heading}</span>
        {notice.notice_date && (
          <span className="my-notice-row__date">{formatNZDate(notice.notice_date, { day: "numeric", month: "short", year: "numeric" })}</span>
        )}
      </div>
      <div className="my-notice-row__actions">
        <Chip label={chip.label} color={chip.color} size="small" />
        {notice.status === "declined" && notice.decline_reason && (
          <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {notice.decline_reason}
          </Typography>
        )}
        <Button
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon fontSize="small" />}
          onClick={handleDelete}
          disabled={deleting}
          sx={{ ml: 1 }}
        >
          {confirmDelete ? "Confirm delete" : "Delete"}
        </Button>
        {confirmDelete && !deleting && (
          <Button size="small" onClick={() => setConfirmDelete(false)} sx={{ ml: 0.5 }}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

export default function NoticeBoard() {
  const { authenticated } = useKeycloak();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [myNotices, setMyNotices] = useState<MyNotice[]>([]);
  const emailVerified = keycloak.tokenParsed?.email_verified === true;

  const loadNotices = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    getNotices()
      .then(setNotices)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
  }, []);

  const loadMyNotices = useCallback(() => {
    if (!authenticated) return;
    getMyNotices().then(setMyNotices).catch(() => {});
  }, [authenticated]);

  useEffect(() => { loadNotices(); }, [loadNotices]);
  useEffect(() => { loadMyNotices(); }, [loadMyNotices]);

  return (
    <PageLayout pageName="Community Notice Board" showComingSoon={false}>

      {loading && (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      )}

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          Could not load notices. Please try again later.
        </Alert>
      )}

      {!loading && !loadError && notices.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          No notices yet — be the first to post one below.
        </Alert>
      )}

      {!loading && !loadError && notices.length > 0 && (
        <div className="notices-list">
          {notices.map((notice) => (
            <NoticeCard key={notice.id} notice={notice} />
          ))}
        </div>
      )}

      {/* ── Your submitted notices ──────────────────────────────────────── */}
      {authenticated && myNotices.length > 0 && (
        <section className="my-notices">
          <h3 className="my-notices__heading">Your submitted notices</h3>
          <div className="my-notices__list">
            {myNotices.map((notice) => (
              <MyNoticeRow
                key={notice.id}
                notice={notice}
                onDeleted={() => {
                  setMyNotices((prev) => prev.filter((n) => n.id !== notice.id));
                  loadNotices();
                }}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── Inline submit form ───────────────────────────────────────────── */}
      <NoticeBoardInlineForm
        authenticated={authenticated}
        emailVerified={emailVerified}
        onSubmitted={() => { loadNotices(); loadMyNotices(); }}
      />

    </PageLayout>
  );
}
