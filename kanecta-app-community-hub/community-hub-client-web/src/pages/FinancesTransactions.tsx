import { useEffect, useState } from "react";
import PageLayout from "../components/PageLayout";
import { useUserRole } from "../auth/useUserRole";
import {
  getTransactions, createTransaction, updateTransaction, deleteTransaction,
  type Transaction, type TransactionInput, INCOME_CATEGORIES, EXPENSE_CATEGORIES, ALL_CATEGORIES,
} from "../api/finances";

const PARENTS = [{ name: "Governance", path: "/governance" }, { name: "Finances", path: "/governance/finances" }];

const EMPTY: TransactionInput = { date: "", description: "", amount: 0, type: "income", category: "membership", reference: "" };

function fmt(amount: string) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(Number(amount));
}

export default function FinancesTransactions() {
  const role = useUserRole();
  const isTreasurer = role === "TREASURER";
  const canView = role !== "PUBLIC" && role !== "GUEST";

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<TransactionInput>(EMPTY);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canView) return;
    getTransactions()
      .then(setTransactions)
      .catch((err: Error) => setError(`Failed to load transactions: ${err.message}`))
      .finally(() => setLoading(false));
  }, [canView]);

  if (!canView) {
    return (
      <PageLayout pageName="Transactions" showComingSoon={false} parents={PARENTS}>
        <p>Financial records are available to logged-in members.</p>
      </PageLayout>
    );
  }

  const categoryOptions = form.type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  function handleTypeChange(type: "income" | "expense") {
    const defaultCat = type === "income" ? "membership" : "hosting";
    setForm(f => ({ ...f, type, category: defaultCat }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (editing !== null) {
        const updated = await updateTransaction(editing, form);
        setTransactions(ts => ts.map(t => t.id === editing ? updated : t));
        setEditing(null);
      } else {
        const created = await createTransaction(form);
        setTransactions(ts => [created, ...ts]);
      }
      setForm(EMPTY);
    } catch {
      setError("Failed to save transaction.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(t: Transaction) {
    setEditing(t.id);
    setForm({ date: t.date.slice(0, 10), description: t.description, amount: Number(t.amount), type: t.type, category: t.category, reference: t.reference ?? "" });
  }

  async function handleDelete(id: number) {
    if (!confirm("Delete this transaction?")) return;
    await deleteTransaction(id);
    setTransactions(ts => ts.filter(t => t.id !== id));
  }

  return (
    <PageLayout pageName="Transactions" showComingSoon={false} parents={PARENTS}>
      {error && <p style={{ color: "red" }}>{error}</p>}

      {isTreasurer && (
        <form className="fin-form" onSubmit={handleSubmit}>
          <h3 className="fin-form__heading">{editing !== null ? "Edit transaction" : "Add transaction"}</h3>
          <div className="fin-form__row">
            <label className="fin-form__label">Date
              <input className="fin-form__input" type="date" required value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
            </label>
            <label className="fin-form__label">Type
              <select className="fin-form__input" value={form.type} onChange={e => handleTypeChange(e.target.value as "income" | "expense")}>
                <option value="income">Income</option>
                <option value="expense">Expense</option>
              </select>
            </label>
            <label className="fin-form__label">Category
              <select className="fin-form__input" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                {Object.entries(categoryOptions).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label className="fin-form__label">Amount (NZD)
              <input className="fin-form__input" type="number" min="0.01" step="0.01" required value={form.amount || ""} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) }))} />
            </label>
          </div>
          <div className="fin-form__row">
            <label className="fin-form__label fin-form__label--wide">Description
              <input className="fin-form__input" type="text" required value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </label>
            <label className="fin-form__label">Reference
              <input className="fin-form__input" type="text" value={form.reference ?? ""} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))} />
            </label>
          </div>
          <div className="fin-form__actions">
            <button className="fin-form__submit" type="submit" disabled={saving}>{saving ? "Saving…" : editing !== null ? "Save changes" : "Add transaction"}</button>
            {editing !== null && <button className="fin-form__cancel" type="button" onClick={() => { setEditing(null); setForm(EMPTY); }}>Cancel</button>}
          </div>
        </form>
      )}

      {loading ? <p>Loading…</p> : (
        <table className="fin-table">
          <thead>
            <tr>
              <th>Date</th><th>Description</th><th>Category</th><th>Reference</th>
              <th className="fin-table__amount">Amount</th>
              {isTreasurer && <th></th>}
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && (
              <tr><td colSpan={isTreasurer ? 6 : 5} className="fin-table__empty">No transactions recorded yet.</td></tr>
            )}
            {transactions.map(t => (
              <tr key={t.id} className={`fin-table__row fin-table__row--${t.type}`}>
                <td className="fin-table__date">{t.date.slice(0, 10)}</td>
                <td>{t.description}</td>
                <td className="fin-table__cat">{ALL_CATEGORIES[t.category] ?? t.category}</td>
                <td className="fin-table__ref">{t.reference ?? ""}</td>
                <td className={`fin-table__amount fin-table__amount--${t.type}`}>
                  {t.type === "expense" ? "−" : "+"}{fmt(t.amount)}
                </td>
                {isTreasurer && (
                  <td className="fin-table__actions">
                    <button onClick={() => startEdit(t)} className="fin-table__btn">Edit</button>
                    <button onClick={() => handleDelete(t.id)} className="fin-table__btn fin-table__btn--del">Delete</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </PageLayout>
  );
}
