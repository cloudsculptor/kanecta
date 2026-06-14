const IS_PROD = window.location.hostname === "featherston.co.nz";

export default function TestEnvironmentBanner() {
  if (IS_PROD) return null;

  return (
    <div className="test-env-banner">
      <strong>Test site:</strong> you can make changes without affecting the live site. Live site is at{" "}
      <a href="https://featherston.co.nz" className="test-env-banner__link">
        featherston.co.nz
      </a>
    </div>
  );
}
