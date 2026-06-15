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

  useEffect(() => {
    if (IS_PROD) return;
    fetch("/build-info.json")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => { if (data) setBuildInfo(data); })
      .catch(() => {});
  }, []);

  if (IS_PROD) return null;

  return (
    <div className="test-env-banner">
      <span className="test-env-banner__label">Test site</span>
      {buildInfo && (
        <span className="test-env-banner__meta">
          {buildInfo.prTitle && <span className="test-env-banner__pr">{buildInfo.prTitle}</span>}
          <code className="test-env-banner__branch">{buildInfo.branch}</code>
          <code className="test-env-banner__sha">{buildInfo.shortSha}</code>
        </span>
      )}
      <span className="test-env-banner__live">
        Live site:{" "}
        <a href="https://featherston.co.nz" className="test-env-banner__link">
          featherston.co.nz
        </a>
      </span>
    </div>
  );
}
