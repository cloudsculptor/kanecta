import { Routes, Route } from "react-router-dom";
import { useKeycloak } from "./auth/KeycloakProvider";
import AppSkeleton from "./components/AppSkeleton";
import RequireModerator from "./components/RequireModerator";
import Approvals from "./pages/Approvals";
import SuggestionsArchive from "./pages/SuggestionsArchive";
import Home from "./pages/Home";
import Events from "./pages/Events";
import EventsOther from "./pages/EventsOther";
import Skills from "./pages/Skills";
import Transport from "./pages/Transport";
import Needs from "./pages/Needs";
import Organisations from "./pages/Organisations";
import GoodsAndServices from "./pages/GoodsAndServices";
import SocialServices from "./pages/SocialServices";
import AboutThisSite from "./pages/AboutThisSite";
import Governance from "./pages/Governance";
import CommunicationNetworks from "./pages/CommunicationNetworks";
import LocalBusinesses from "./pages/LocalBusinesses";
import LocalGovernment from "./pages/LocalGovernment";
import Discussions from "./pages/Discussions";
import TeamRequired from "./pages/TeamRequired";
import Roadmap from "./pages/Roadmap";
import Constitution from "./pages/Constitution";
import Roles from "./pages/Roles";
import Values from "./pages/Values";
import Purpose from "./pages/Purpose";
import PoliciesIndex from "./pages/PoliciesIndex";
import ProceduresIndex from "./pages/ProceduresIndex";
import GovernanceSectionList from "./pages/GovernanceSectionList";
import GovernancePageView from "./pages/GovernancePageView";
import GovernancePageEdit from "./pages/GovernancePageEdit";
import Volunteering from "./pages/Volunteering";
import FinancesIndex from "./pages/FinancesIndex";
import FinancesTransactions from "./pages/FinancesTransactions";
import FinancesCashflow from "./pages/FinancesCashflow";
import FinancesProfitLoss from "./pages/FinancesProfitLoss";
import FinancesExpenses from "./pages/FinancesExpenses";
import RoleCustodian from "./pages/RoleCustodian";
import RoleVolunteer from "./pages/RoleVolunteer";
import Groups from "./pages/Groups";
import MembershipPanel from "./pages/MembershipPanel";
import PagesList from "./pages/PagesList";
import PageEdit from "./pages/PageEdit";
import PageView from "./pages/PageView";
import PageHistory from "./pages/PageHistory";
import PageVersion from "./pages/PageVersion";
import PagesListPublic from "./pages/PagesListPublic";
import PageViewPublic from "./pages/PageViewPublic";
import Download from "./pages/Download";
import Settings from "./pages/Settings";
import NoticeBoard from "./pages/NoticeBoard";
import Profile from "./pages/Profile";
import CommunityResilience from "./pages/CommunityResilience";
import Education from "./pages/Education";

export default function App() {
  const { initialized } = useKeycloak();
  if (!initialized) return <AppSkeleton />;

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/events" element={<Events />} />
      <Route path="/events/other" element={<EventsOther />} />
      <Route path="/skills" element={<Skills />} />
      <Route path="/transport" element={<Transport />} />
      <Route path="/needs" element={<Needs />} />
      <Route path="/organisations" element={<Organisations />} />
      <Route path="/goods-and-services" element={<GoodsAndServices />} />
      <Route path="/social-services" element={<SocialServices />} />
      <Route path="/about" element={<AboutThisSite />} />
      <Route path="/download" element={<Download />} />
      <Route path="/groups" element={<Groups />} />
      <Route path="/groups/resilience" element={<PagesList />} />
      <Route path="/resilience/pages" element={<PagesListPublic />} />
      <Route path="/resilience/pages/:slug" element={<PageViewPublic />} />
      <Route path="/communication-networks" element={<CommunicationNetworks />} />
      <Route path="/local-businesses" element={<LocalBusinesses />} />
      <Route path="/local-government" element={<LocalGovernment />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/notice-board" element={<NoticeBoard />} />
      <Route path="/profile" element={<Profile />} />
      <Route path="/community-resilience" element={<CommunityResilience />} />
      <Route path="/education" element={<Education />} />
      <Route path="/discussions" element={<Discussions />} />
      <Route path="/discussions/team-required" element={<TeamRequired />} />
      <Route path="/roadmap" element={<Roadmap />} />
      <Route path="/volunteering" element={<Volunteering />} />
      <Route path="/groups/resilience/:slug/history" element={<PageHistory />} />
      <Route path="/groups/resilience/:slug/v/:version" element={<PageVersion />} />
      <Route path="/groups/resilience/:slug" element={<PageView />} />
      <Route path="/pages" element={<PagesList />} />
      <Route path="/pages/new" element={<PageEdit />} />
      <Route path="/groups/resilience/new" element={<PageEdit />} />
      <Route path="/pages/:slug/edit" element={<PageEdit />} />
      <Route path="/groups/resilience/:slug/edit" element={<PageEdit />} />
      <Route path="/site-pages/:slug/edit" element={<PageEdit />} />
      <Route path="/site-pages/:slug/history" element={<PageHistory />} />
      <Route path="/site-pages/:slug/v/:version" element={<PageVersion />} />

      {/* Governance — public */}
      <Route path="/governance" element={<Governance />} />
      <Route path="/governance/purpose" element={<Purpose />} />
      <Route path="/governance/values" element={<Values />} />
      <Route path="/governance/roles" element={<Roles />} />
      <Route path="/governance/roles/custodian" element={<RoleCustodian />} />
      <Route path="/governance/roles/volunteer" element={<RoleVolunteer />} />
      <Route path="/governance/constitution" element={<Constitution />} />
      <Route path="/governance/policies" element={<PoliciesIndex />} />
      <Route path="/governance/policies/:category/new" element={<GovernancePageEdit type="policy" />} />
      <Route path="/governance/policies/:category/:slug/edit" element={<GovernancePageEdit type="policy" />} />
      <Route path="/governance/policies/:category/:slug" element={<GovernancePageView type="policy" />} />
      <Route path="/governance/policies/:category" element={<GovernanceSectionList type="policy" />} />
      <Route path="/governance/procedures" element={<ProceduresIndex />} />
      <Route path="/governance/procedures/:category/new" element={<GovernancePageEdit type="procedure" />} />
      <Route path="/governance/procedures/:category/:slug/edit" element={<GovernancePageEdit type="procedure" />} />
      <Route path="/governance/procedures/:category/:slug" element={<GovernancePageView type="procedure" />} />
      <Route path="/governance/procedures/:category" element={<GovernanceSectionList type="procedure" />} />
      <Route path="/governance/finances" element={<FinancesIndex />} />
      <Route path="/governance/finances/transactions" element={<FinancesTransactions />} />
      <Route path="/governance/finances/cashflow" element={<FinancesCashflow />} />
      <Route path="/governance/finances/profit-and-loss" element={<FinancesProfitLoss />} />
      <Route path="/governance/finances/expenses" element={<FinancesExpenses />} />
      <Route path="/governance/membership" element={<MembershipPanel />} />

      {/* Moderators only */}
      <Route element={<RequireModerator />}>
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/suggestions/archive" element={<SuggestionsArchive />} />
      </Route>
    </Routes>
  );
}
