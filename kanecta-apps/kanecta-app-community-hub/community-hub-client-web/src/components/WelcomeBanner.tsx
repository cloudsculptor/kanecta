import { useState } from "react";
import CloseIcon from "@mui/icons-material/Close";
import keycloak from "../auth/keycloak";

const COOKIE = "welcome_dismissed";

function isCookieSet(): boolean {
  return document.cookie.split(";").some((c) => c.trim().startsWith(COOKIE + "="));
}

function setDismissCookie() {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${COOKIE}=1; expires=${expires}; path=/; SameSite=Lax`;
}

export default function WelcomeBanner() {
  const [dismissed, setDismissed] = useState(() => isCookieSet());

  if (dismissed) return null;

  function dismiss() {
    setDismissCookie();
    setDismissed(true);
  }

  return (
    <div className="welcome-banner">
      <button className="welcome-banner__close" onClick={dismiss} aria-label="Dismiss welcome message">
        <CloseIcon fontSize="small" />
      </button>
      <h2 className="welcome-banner__title">Welcome to Featherston</h2>
      <p className="welcome-banner__body">
        Featherston is a small town nestled at the foot of the Remutaka Range in the South Wairarapa,
        New Zealand — surrounded by rolling hills, vineyards, and one of the most beautiful rail trails
        in the country. It's a tight-knit, welcoming community and we're glad you're here.
      </p>
      <p className="welcome-banner__body">
        This site is built and maintained by local volunteers. It's a free, open-source resource for
        finding local events, discovering community groups, connecting with services, and staying
        in touch with what's happening in town.
      </p>
      <p className="welcome-banner__body">
        Want to get involved?{" "}
        <button className="welcome-banner__signup" onClick={() => keycloak.register()}>
          Create a free account
        </button>{" "}
        and start contributing to your community.
      </p>
    </div>
  );
}
