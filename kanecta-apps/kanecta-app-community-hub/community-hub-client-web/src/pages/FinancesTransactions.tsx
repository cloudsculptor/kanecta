import { useEffect, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import PageLayout from "../components/PageLayout";
import { useUserRoles, hasRole } from "../auth/useUserRole";
import {
  getTransactions, createTransaction, updateTransaction, deleteTransaction,
  type Transaction, type TransactionInput, INCOME_CATEGORIES, EXPENSE_CATEGORIES, ALL_CATEGORIES,
} from "../api/finances";

const PARENTS = [{ name: "Governance", path: "/governance" }, { name: "Finances", path: "/governance/finances" }];

const EMPTY: TransactionInput = { date: "", description: "", amount: 0, type: "income", category: "membership", reference: "" };

function fmt(amount: string | number) {
  return new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }).format(Number(amount));
}

export default function FinancesTransactions() {
  const roles = useUserRoles();
  const isTreasurer = hasRole(roles, "treasurer");

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<TransactionInput>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  useEffect(() => {
    getTransactions()
      .then(setTransactions)
      .catch((err: Error) => setError(`Failed to load transactions: ${err.message}`))
      .finally(() => setLoading(false));
  }, []);

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

  async function handleDelete(id: string) {
    if (!confirm("Delete this transaction?")) return;
    await deleteTransaction(id);
    setTransactions(ts => ts.filter(t => t.id !== id));
  }

  return (
    <PageLayout pageName="Transactions" showComingSoon={false} wip parents={PARENTS}>
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
              <input className="fin-form__input" type="number" step="0.01" required value={form.amount || ""} onChange={e => setForm(f => ({ ...f, amount: parseFloat(e.target.value) }))} />
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

      {loading ? <p>Loading…</p> : (() => {
        // API returns oldest-first (date ASC, sort_order ASC). Running balance is a simple cumulative sum.
        let running = 0;
        const rows = transactions.map(t => {
          running += Number(t.amount);
          return { ...t, balance: running };
        });
        const cols = isTreasurer ? 7 : 6;
        return (
          <table className="fin-table">
            <thead>
              <tr>
                <th className="fin-table__id">ID</th>
                <th>Date</th><th>Description</th><th>Category</th><th>Reference</th>
                <th className="fin-table__amount">Amount</th>
                <th className="fin-table__amount">Balance</th>
                <th></th>
                {isTreasurer && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={cols + 1} className="fin-table__empty">No transactions recorded yet.</td></tr>
              )}
              {rows.map(t => (
                <tr key={t.id} className={`fin-table__row fin-table__row--${t.type}`}>
                  <td className="fin-table__id" title={t.id}>{t.id.slice(0, 8)}…</td>
                  <td className="fin-table__date">{new Date(t.date).toLocaleDateString("en-NZ", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })}</td>
                  <td>{t.description}</td>
                  <td className="fin-table__cat">{ALL_CATEGORIES[t.category] ?? t.category}</td>
                  <td className="fin-table__ref">{t.reference ?? ""}</td>
                  <td className={`fin-table__amount fin-table__amount--${Number(t.amount) < 0 ? "expense" : "income"}`}>
                    {fmt(t.amount)}
                  </td>
                  <td className={`fin-table__amount fin-table__amount--balance ${t.balance < 0 ? "fin-table__amount--deficit" : ""}`}>
                    {fmt(t.balance)}
                  </td>
                  <td className="fin-table__files">
                    {t.file_count > 0 && (
                      <button className="fin-table__file-btn" onClick={() => setFilesOpen(true)} title="View files">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/>
                        </svg>
                        {t.file_count > 1 && <span className="fin-table__file-count">{t.file_count}</span>}
                      </button>
                    )}
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
        );
      })()}
      <Dialog open={filesOpen} onClose={() => setFilesOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Files</DialogTitle>
        <DialogContent>
          <p style={{ margin: 0 }}>These files are stored by the administrator.</p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFilesOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

    </PageLayout>
  );
}
