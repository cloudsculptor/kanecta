import { type ReactNode } from "react";
import Alert from "@mui/material/Alert";
import Header from "./Header";
import Breadcrumb from "./Breadcrumb";
import ComingSoon from "./ComingSoon";
import Footer from "./Footer";
import { usePageMeta } from "../hooks/usePageMeta";
import { useKeycloak } from "../auth/KeycloakProvider";
import { useUserRoles } from "../auth/useUserRole";

interface Crumb {
  name: string;
  path: string;
}

interface PageLayoutProps {
  pageName: string;
  children?: ReactNode;
  showComingSoon?: boolean;
  parents?: Crumb[];
  wip?: boolean;
}

export default function PageLayout({
  pageName,
  children,
  showComingSoon = true,
  parents,
  wip = false,
}: PageLayoutProps) {
  usePageMeta(pageName);
  const { authenticated } = useKeycloak();
  const roles = useUserRoles();
  const isGuest = authenticated && roles.length === 0;

  return (
    <>
      <Header />
      {isGuest && (
        <Alert severity="warning" sx={{ borderRadius: 0, fontSize: "0.95rem" }}>
          <strong>Welcome!</strong> Your membership request has been submitted and one of our moderators will approve it soon.
          If you don't hear back shortly, please contact us at{" "}
          <a href="mailto:hello@featherston.co.nz">hello@featherston.co.nz</a>.
        </Alert>
      )}
      <Breadcrumb pageName={pageName} parents={parents} />
      <main className="page-content">
        <h2>{pageName}</h2>
        {showComingSoon && <ComingSoon />}
        {wip && (
          <Alert severity="warning" sx={{ mb: 3, fontSize: "1rem" }}>
            <strong>Work in progress</strong> — this governance model is still being developed.
            Please take it with a grain of salt until this banner is removed.
          </Alert>
        )}
        {children}
      </main>
      <Footer />
    </>
  );
}
