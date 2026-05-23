import { Link } from "react-router-dom";
import PageLayout from "../components/PageLayout";

const pages = [
  { title: "Transactions", path: "/governance/finances/transactions", description: "All income and expenditure records." },
  { title: "Cash Flow", path: "/governance/finances/cashflow", description: "NZ standard cash flow statement for a selected period." },
  { title: "Profit & Loss", path: "/governance/finances/profit-and-loss", description: "NZ standard income & expenditure statement for a selected period." },
  { title: "Recurring Expenses", path: "/governance/finances/expenses", description: "Expected recurring costs broken down by frequency with NZD totals." },
];

export default function FinancesIndex() {
  return (
    <PageLayout pageName="Finances" showComingSoon={false} wip parents={[{ name: "Governance", path: "/governance" }]}>
      <p>Financial records for this organisation, published in accordance with our openness commitments.</p>
      <div className="role-index" style={{ marginTop: "1rem" }}>
        {pages.map(({ title, path, description }) => (
          <Link key={path} to={path} className="role-index__item">
            <span className="role-index__title">{title}</span>
            <span className="role-index__description">{description}</span>
            <span className="role-index__arrow">→</span>
          </Link>
        ))}
      </div>
    </PageLayout>
  );
}
