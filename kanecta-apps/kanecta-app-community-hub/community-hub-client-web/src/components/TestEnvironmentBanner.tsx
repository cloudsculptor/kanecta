import { useEffect, useState } from "react";

const IS_PROD = window.location.hostname === "featherston.co.nz";

interface BuildInfo {
  branch: string;
  shortSha: string;
  prTitle: string;
  deployedAt: string;
}

export default function TestEnvironmentBanner() {
  const [buildInfo, setBuildInfo] = useState<BuildInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (IS_PROD) return;
    fetch("/build-info.json", { cache: "no-store" })
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setBuildInfo(data); })
      .catch(() => {});
  }, []);

  if (IS_PROD) return null;

  const versionString = buildInfo ? `${buildInfo.branch}:${buildInfo.shortSha}` : null;

  function handleCopy() {
    if (!versionString) return;
    navigator.clipboard.writeText(versionString).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="test-env-banner">
      <div className="test-env-banner__line">
        <strong>Test site:</strong> you can make changes without affecting the live site. Live site is at{" "}
        <a href="https://featherston.co.nz" className="test-env-banner__link">
          featherston.co.nz
        </a>
      </div>
      {versionString && (
        <div className="test-env-banner__line">
          Deployed version:
          <span className="test-env-banner__version-box">
            <code className="test-env-banner__version-text">{versionString}</code>
            <button
              className="test-env-banner__copy"
              onClick={handleCopy}
              aria-label="Copy version to clipboard"
              title={copied ? "Copied!" : "Copy to clipboard"}
            >
              {copied ? (
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
              )}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
