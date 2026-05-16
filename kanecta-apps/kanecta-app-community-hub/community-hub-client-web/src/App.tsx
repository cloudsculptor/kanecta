import { Routes, Route } from "react-router-dom";
import { useKeycloak } from "./auth/KeycloakProvider";
import AppSkeleton from "./components/AppSkeleton";
import RequireTeam from "./components/RequireTeam";
import Home from "./pages/Home";
import Events from "./pages/Events";
import Skills from "./pages/Skills";
import Transport from "./pages/Transport";
import Needs from "./pages/Needs";
import Organisations from "./pages/Organisations";
import GoodsAndServices from "./pages/GoodsAndServices";
import SocialServices from "./pages/SocialServices";
import AboutThisSite from "./pages/AboutThisSite";
import Governance from "./pages/Governance";
import Resilience from "./pages/Resilience";
import Kai from "./pages/Kai";
import TransportAndMobility from "./pages/TransportAndMobility";
import SkillSharing from "./pages/SkillSharing";
import CommunicationNetworks from "./pages/CommunicationNetworks";
import LocalEconomy from "./pages/LocalEconomy";
import Discussions from "./pages/Discussions";
import TeamRequired from "./pages/TeamRequired";
import Roadmap from "./pages/Roadmap";
import Constitution from "./pages/Constitution";
import Roles from "./pages/Roles";
import Values from "./pages/Values";
import Purpose from "./pages/Purpose";
import PoliciesIndex from "./pages/PoliciesIndex";
import PolicyCustodianBylaws from "./pages/PolicyCustodianBylaws";
import PolicyCustodianGuidelines from "./pages/PolicyCustodianGuidelines";
import PolicyVolunteerBylaws from "./pages/PolicyVolunteerBylaws";
import PolicyVolunteerGuidelines from "./pages/PolicyVolunteerGuidelines";
import ProceduresIndex from "./pages/ProceduresIndex";
import ProcedureContentModeration from "./pages/ProcedureContentModeration";
import ProcedureVolunteerOnboarding from "./pages/ProcedureVolunteerOnboarding";
import ProcedureComplaintHandling from "./pages/ProcedureComplaintHandling";
import ProcedureItIncidentResponse from "./pages/ProcedureItIncidentResponse";
import ProcedureDomainAndHosting from "./pages/ProcedureDomainAndHosting";
import ProcedureBackupAndRecovery from "./pages/ProcedureBackupAndRecovery";
import ProcedureBoardMeeting from "./pages/ProcedureBoardMeeting";
import ProcedureAgm from "./pages/ProcedureAgm";
import ProcedureFinancialReporting from "./pages/ProcedureFinancialReporting";
import ProcedureStatutoryCompliance from "./pages/ProcedureStatutoryCompliance";
import Volunteering from "./pages/Volunteering";
import FinancesIndex from "./pages/FinancesIndex";
import FinancesTransactions from "./pages/FinancesTransactions";
import FinancesCashflow from "./pages/FinancesCashflow";
import FinancesProfitLoss from "./pages/FinancesProfitLoss";
import FinancesExpenses from "./pages/FinancesExpenses";
import RoleCustodian from "./pages/RoleCustodian";
import RoleVolunteer from "./pages/RoleVolunteer";
import Groups from "./pages/Groups";
import ResilienceGroup from "./pages/ResilienceGroup";
import PagesList from "./pages/PagesList";
import PageEdit from "./pages/PageEdit";
import PageView from "./pages/PageView";

export default function App() {
  const { initialized } = useKeycloak();
  if (!initialized) return <AppSkeleton />;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/events" element={<Events />} />
      <Route path="/skills" element={<Skills />} />
      <Route path="/transport" element={<Transport />} />
      <Route path="/needs" element={<Needs />} />
      <Route path="/organisations" element={<Organisations />} />
      <Route path="/goods-and-services" element={<GoodsAndServices />} />
      <Route path="/social-services" element={<SocialServices />} />
      <Route path="/about" element={<AboutThisSite />} />
      <Route path="/groups" element={<Groups />} />
      <Route path="/groups/resilience" element={<ResilienceGroup />} />
      <Route path="/resilience" element={<Resilience />} />
      <Route path="/kai" element={<Kai />} />
      <Route path="/transport-and-mobility" element={<TransportAndMobility />} />
      <Route path="/skill-sharing" element={<SkillSharing />} />
      <Route path="/communication-networks" element={<CommunicationNetworks />} />
      <Route path="/local-economy" element={<LocalEconomy />} />
      <Route path="/discussions" element={<Discussions />} />
      <Route path="/discussions/team-required" element={<TeamRequired />} />
      <Route path="/roadmap" element={<Roadmap />} />
      <Route path="/volunteering" element={<Volunteering />} />
      <Route path="/groups/resilience/:slug" element={<PageView />} />
      <Route path="/pages" element={<PagesList />} />
      <Route path="/pages/new" element={<PageEdit />} />
      <Route path="/pages/:slug/edit" element={<PageEdit />} />

      {/* Governance — team members only */}
      <Route element={<RequireTeam />}>
        <Route path="/governance" element={<Governance />} />
        <Route path="/governance/purpose" element={<Purpose />} />
        <Route path="/governance/values" element={<Values />} />
        <Route path="/governance/roles" element={<Roles />} />
        <Route path="/governance/roles/custodian" element={<RoleCustodian />} />
        <Route path="/governance/roles/volunteer" element={<RoleVolunteer />} />
        <Route path="/governance/constitution" element={<Constitution />} />
        <Route path="/governance/policies" element={<PoliciesIndex />} />
        <Route path="/governance/policies/custodian-bylaws" element={<PolicyCustodianBylaws />} />
        <Route path="/governance/policies/custodian-guidelines" element={<PolicyCustodianGuidelines />} />
        <Route path="/governance/policies/volunteer-bylaws" element={<PolicyVolunteerBylaws />} />
        <Route path="/governance/policies/volunteer-guidelines" element={<PolicyVolunteerGuidelines />} />
        <Route path="/governance/procedures" element={<ProceduresIndex />} />
        <Route path="/governance/procedures/content-moderation" element={<ProcedureContentModeration />} />
        <Route path="/governance/procedures/volunteer-onboarding" element={<ProcedureVolunteerOnboarding />} />
        <Route path="/governance/procedures/complaint-handling" element={<ProcedureComplaintHandling />} />
        <Route path="/governance/procedures/it-incident-response" element={<ProcedureItIncidentResponse />} />
        <Route path="/governance/procedures/domain-and-hosting" element={<ProcedureDomainAndHosting />} />
        <Route path="/governance/procedures/backup-and-recovery" element={<ProcedureBackupAndRecovery />} />
        <Route path="/governance/procedures/board-meeting" element={<ProcedureBoardMeeting />} />
        <Route path="/governance/procedures/agm" element={<ProcedureAgm />} />
        <Route path="/governance/procedures/financial-reporting" element={<ProcedureFinancialReporting />} />
        <Route path="/governance/procedures/statutory-compliance" element={<ProcedureStatutoryCompliance />} />
        <Route path="/governance/finances" element={<FinancesIndex />} />
        <Route path="/governance/finances/transactions" element={<FinancesTransactions />} />
        <Route path="/governance/finances/cashflow" element={<FinancesCashflow />} />
        <Route path="/governance/finances/profit-and-loss" element={<FinancesProfitLoss />} />
        <Route path="/governance/finances/expenses" element={<FinancesExpenses />} />
      </Route>
    </Routes>
  );
}
