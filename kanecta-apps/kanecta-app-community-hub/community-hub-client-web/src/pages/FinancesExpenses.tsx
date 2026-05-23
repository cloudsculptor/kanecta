import { useEffect, useState } from "react";
import PageLayout from "../components/PageLayout";
import { getExpenses, type Expense, EXPENSE_CATEGORIES } from "../api/finances";

const PARENTS = [{ name: "Governance", path: "/governance" }, { name: "Finances", path: "/governance/finances" }];

function fmtNZD(amount: string) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(Number(amount));
}

function fmtOrig(amount: string, currency: string) {
  if (currency === "NZD") return fmtNZD(amount);
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(amount));
}

function ExpenseTable({ rows }: { rows: Expense[] }) {
  return (
    <table className="fin-table">
      <thead>
        <tr>
          <th>Supplier</th>
          <th>Description</th>
          <th>Category</th>
          <th className="fin-table__amount">Amount</th>
          <th className="fin-table__amount">NZD</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(e => (
          <tr key={e.id} className="fin-table__row fin-table__row--expense">
            <td>{e.supplier}</td>
            <td>
              {e.url
                ? <a href={e.url} target="_blank" rel="noopener noreferrer">{e.description}</a>
                : e.description}
            </td>
            <td className="fin-table__cat">{EXPENSE_CATEGORIES[e.category] ?? e.category}</td>
            <td className="fin-table__amount fin-table__amount--expense">
              {fmtOrig(e.amount, e.currency)}{e.currency !== "NZD" && <span className="fin-table__currency"> {e.currency}</span>}
            </td>
            <td className="fin-table__amount fin-table__amount--expense">{fmtNZD(e.nzd_amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function FinancesExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getExpenses()
      .then(setExpenses)
      .catch((err: Error) => setError(`Failed to load: ${err.message}`))
      .finally(() => setLoading(false));
  }, []);

  const monthly = expenses.filter(e => e.frequency === "monthly");
  const annual  = expenses.filter(e => e.frequency === "annual");

  const monthlyNZD = monthly.reduce((s, e) => s + Number(e.nzd_amount), 0);
  const annualNZD  = annual.reduce((s, e) => s + Number(e.nzd_amount), 0);
  const totalAnnualNZD = monthlyNZD * 12 + annualNZD;

  return (
    <PageLayout pageName="Recurring Expenses" showComingSoon={false} parents={PARENTS}>
      <p>Expected recurring costs. NZD amounts for USD items use the exchange rate at the time of entry.</p>

      {error && <p style={{ color: "red" }}>{error}</p>}
      {loading ? <p>Loading…</p> : (
        <>
          <h3 className="fin-expenses__freq-heading">Monthly</h3>
          <ExpenseTable rows={monthly} />
          <div className="fin-expenses__subtotal">
            <span>Monthly total</span><span>{fmtNZD(String(monthlyNZD))}</span>
          </div>

          <h3 className="fin-expenses__freq-heading">Annual</h3>
          <ExpenseTable rows={annual} />
          <div className="fin-expenses__subtotal">
            <span>Annual total</span><span>{fmtNZD(String(annualNZD))}</span>
          </div>

          <div className="fin-expenses__annual-total">
            <span>Total annual cost (monthly × 12 + annual)</span>
            <span>{fmtNZD(String(totalAnnualNZD))}</span>
          </div>
          <div className="fin-expenses__subtotal" style={{ marginTop: "0.5rem" }}>
            <span>Average monthly cost</span>
            <span>{fmtNZD(String(Math.round(totalAnnualNZD / 12 * 100) / 100))}</span>
          </div>
        </>
      )}
    </PageLayout>
  );
}
