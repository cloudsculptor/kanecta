import { useState } from "react";
import Tooltip from "@mui/material/Tooltip";

const IconLink = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
);

export default function CopyLinkButton() {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Tooltip
      title={copied ? "Copied!" : "Copy link"}
      open={copied ? true : undefined}
      placement="top"
    >
      <button
        className="discussions-options-btn"
        onClick={handleCopy}
        aria-label="Copy link to thread"
      >
        <IconLink />
      </button>
    </Tooltip>
  );
}
