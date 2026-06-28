import { Outlet } from "react-router-dom";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import Header from "./Header";
import Footer from "./Footer";

export default function RequireTeam() {
  const roles = useUserRoles();
  if (hasRole(roles, "team")) {
    return <Outlet />;
  }
  return (
    <>
      <Header />
      <main className="page-content" style={{ textAlign: "center", paddingTop: "4rem" }}>
        <p style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-h)" }}>Members only</p>
        <p style={{ color: "var(--text)" }}>You need to be logged in as a team member to view this section.</p>
      </main>
      <Footer />
    </>
  );
}
