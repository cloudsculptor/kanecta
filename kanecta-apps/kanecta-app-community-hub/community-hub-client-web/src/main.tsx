import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { KeycloakProvider } from "./auth/KeycloakProvider";
import "./index.scss";
import "./App.scss";
import App from "./App.tsx";

if ("serviceWorker" in navigator) {
  if (window.location.hostname === "featherston.co.nz") {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      regs.forEach((r) => r.unregister());
    });
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KeycloakProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </KeycloakProvider>
  </StrictMode>,
);
