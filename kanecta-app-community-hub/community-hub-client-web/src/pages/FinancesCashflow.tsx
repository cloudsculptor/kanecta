import { useEffect, useState } from "react";
import PageLayout from "../components/PageLayout";
import { useUserRole } from "../auth/useUserRole";
import { getReports, type ReportRow, INCOME_CATEGORIES, EXPENSE_CATEGORIES } from "../api/finances";

const PARENTS = [{ name: "Governance", path: "/governance" }, { name: "Finances", path: "/governance/finances" }];

function fmt(n: number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(n);
}

function currentFinancialYear() {
  const now = new Date();
  const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${year}-04-01`, to: `${year + 1}-03-31` };
}

export default function FinancesCashflow() {
  const role = useUserRole();
  const canView = role !== "PUBLIC" && role !== "GUEST";
  const fy = currentFinancialYear();

  const [from, setFrom] = useState(fy.from);
  const [to, setTo] = useState(fy.to);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canView) return;
    setLoading(true);
    getReports(from, to).then(setRows).finally(() => setLoading(false));
  }, [canView, from, to]);

  if (!canView) {
    return (
      <PageLayout pageName="Cash Flow" showComingSoon={false} parents={PARENTS}>
        <p>Financial records are available to logged-in members.</p>
      </PageLayout>
    );
  }

  const income = rows.filter(r => r.type === "income");
  const expense = rows.filter(r => r.type === "expense");
  const totalIncome  = income.reduce((s, r) => s + Number(r.total), 0);
  const totalExpense = expense.reduce((s, r) => s + Number(r.total), 0);
  const netOperating = totalIncome - totalExpense;

  return (
    <PageLayout pageName="Cash Flow" showComingSoon={false} parents={PARENTS}>
      <p className="fin-report__note">Cash flow statement prepared in accordance with NZ reporting standards for small incorporated societies.</p>

      <div className="fin-period">
        <label>From <input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To <input type="date" value={to}   onChange={e => setTo(e.target.value)}   /></label>
      </div>

      {loading ? <p>Loading…</p> : (
        <div className="fin-report">
          <h3 className="fin-report__section">Cash flows from operating activities</h3>

          <div className="fin-report__group">
            <p className="fin-report__group-label">Receipts</p>
            {income.map(r => (
              <div key={r.category} className="fin-report__row">
                <span>{INCOME_CATEGORIES[r.category] ?? r.category}</span>
                <span>{fmt(Number(r.total))}</span>
              </div>
            ))}
            {income.length === 0 && <div className="fin-report__row fin-report__row--empty"><span>No income recorded</span><span>{fmt(0)}</span></div>}
            <div className="fin-report__subtotal">
              <span>Total receipts</span><span>{fmt(totalIncome)}</span>
            </div>
          </div>

          <div className="fin-report__group">
            <p className="fin-report__group-label">Payments</p>
            {expense.map(r => (
              <div key={r.category} className="fin-report__row">
                <span>{EXPENSE_CATEGORIES[r.category] ?? r.category}</span>
                <span>({fmt(Number(r.total))})</span>
              </div>
            ))}
            {expense.length === 0 && <div className="fin-report__row fin-report__row--empty"><span>No payments recorded</span><span>{fmt(0)}</span></div>}
            <div className="fin-report__subtotal">
              <span>Total payments</span><span>({fmt(totalExpense)})</span>
            </div>
          </div>

          <div className={`fin-report__total ${netOperating < 0 ? "fin-report__total--deficit" : ""}`}>
            <span>Net cash from operating activities</span>
            <span>{netOperating < 0 ? `(${fmt(Math.abs(netOperating))})` : fmt(netOperating)}</span>
          </div>

          <div className="fin-report__group fin-report__group--investing">
            <p className="fin-report__group-label">Cash flows from investing activities</p>
            <div className="fin-report__row fin-report__row--empty"><span>No investing activities</span><span>{fmt(0)}</span></div>
            <div className="fin-report__subtotal"><span>Net cash from investing activities</span><span>{fmt(0)}</span></div>
          </div>

          <div className="fin-report__group fin-report__group--investing">
            <p className="fin-report__group-label">Cash flows from financing activities</p>
            <div className="fin-report__row fin-report__row--empty"><span>No financing activities</span><span>{fmt(0)}</span></div>
            <div className="fin-report__subtotal"><span>Net cash from financing activities</span><span>{fmt(0)}</span></div>
          </div>

          <div className={`fin-report__total fin-report__total--net ${netOperating < 0 ? "fin-report__total--deficit" : ""}`}>
            <span>Net increase / (decrease) in cash held</span>
            <span>{netOperating < 0 ? `(${fmt(Math.abs(netOperating))})` : fmt(netOperating)}</span>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
