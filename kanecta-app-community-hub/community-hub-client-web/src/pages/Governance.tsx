import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

export default function Governance() {
  return (
    <PageLayout pageName="Governance" showComingSoon={false}>
      <p><Link to="/governance/constitution">Constitution</Link></p>
      <p><Link to="/governance/roles">Roles</Link></p>
    </PageLayout>
  );
}
