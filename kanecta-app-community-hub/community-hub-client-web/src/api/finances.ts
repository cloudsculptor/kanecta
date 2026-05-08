import keycloak from "../auth/keycloak";

const BASE = import.meta.env.VITE_API_URL ?? "";

async function authFetch(path: string, init: RequestInit = {}) {
  const token = keycloak.token;
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: string;
  type: "income" | "expense";
  category: string;
  reference: string | null;
  created_by_name: string;
  created_at: string;
  file_count: number;
}

export interface TransactionInput {
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  category: string;
  reference?: string;
}

export interface ReportRow {
  type: "income" | "expense";
  category: string;
  total: string;
}

export const INCOME_CATEGORIES: Record<string, string> = {
  membership:   "Membership contributions",
  donation:     "Donations",
  grant:        "Grants & funding",
  interest:     "Interest received",
  other_income: "Other income",
};

export const EXPENSE_CATEGORIES: Record<string, string> = {
  hosting:        "Hosting & infrastructure",
  domain:         "Domain registration",
  software:       "Software & subscriptions",
  administration: "Administration & office",
  legal:          "Legal & professional fees",
  insurance:      "Insurance",
  bank_charges:   "Bank charges",
  events:         "Events & meetings",
  other_expense:  "Other expenditure",
};

export const ALL_CATEGORIES = { ...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES };

export function getTransactions(from?: string, to?: string): Promise<Transaction[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to)   params.set("to", to);
  const qs = params.toString();
  return authFetch(`/api/finances/transactions${qs ? "?" + qs : ""}`);
}

export function createTransaction(data: TransactionInput): Promise<Transaction> {
  return authFetch("/api/finances/transactions", { method: "POST", body: JSON.stringify(data) });
}

export function updateTransaction(id: string, data: TransactionInput): Promise<Transaction> {
  return authFetch(`/api/finances/transactions/${id}`, { method: "PUT", body: JSON.stringify(data) });
}

export function deleteTransaction(id: string): Promise<void> {
  return authFetch(`/api/finances/transactions/${id}`, { method: "DELETE" });
}

export interface Expense {
  id: string;
  supplier: string;
  description: string;
  category: string;
  frequency: "monthly" | "annual";
  currency: string;
  amount: string;
  nzd_amount: string;
  url: string | null;
}

export function getExpenses(): Promise<Expense[]> {
  return authFetch("/api/finances/expenses");
}

export function getReports(from?: string, to?: string): Promise<ReportRow[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to)   params.set("to", to);
  const qs = params.toString();
  return authFetch(`/api/finances/reports${qs ? "?" + qs : ""}`);
}
