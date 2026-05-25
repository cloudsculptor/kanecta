import { Typography, Box } from "@mui/material";
import type { Notice } from "../../api/notices";
import { formatNZDate, formatNZDateTime } from "../../utils/dates";

function linkifyText(text: string): React.ReactNode[] {
  const urlPattern = /https?:\/\/[^\s]+/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const url = match[0];
    parts.push(
      <a key={match.index} href={url} target="_blank" rel="noopener noreferrer">
        {url}
      </a>
    );
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}


export default function NoticeCard({ notice }: { notice: Notice }) {
  return (
    <div className="notice-card">
      <div className="notice-card__heading">{notice.heading}</div>
      {notice.notice_date && (
        <div className="notice-card__date">{formatNZDate(notice.notice_date)}</div>
      )}
      <Typography
        variant="body2"
        className="notice-card__body"
        sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {linkifyText(notice.body)}
      </Typography>
      <Box className="notice-card__meta">
        <Typography variant="caption" color="text.secondary">
          {notice.submitted_by_name ?? "Community member"} · {formatNZDateTime(notice.submitted_at)}
        </Typography>
      </Box>
    </div>
  );
}
