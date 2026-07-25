import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  listTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getReport,
  listExpenses,
} from "../repositories/finances.js";

const router = Router();

const VALID_CATEGORIES = [
  "membership", "donation", "grant", "interest", "other_income",
  "hosting", "domain", "software", "administration", "legal",
  "insurance", "bank_charges", "events", "other_expense",
];

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// ── List transactions (any authenticated user) ────────────────────────────────
router.get("/transactions", wrap(async (req, res) => {
  const { from, to } = req.query;
  res.json(await listTransactions({ from, to }));
}));

// ── Create transaction (treasurer only) ──────────────────────────────────────
router.post("/transactions", requireAuth, requireRole("treasurer"), wrap(async (req, res) => {
  const { date, description, amount, type, category, reference, sort_order } = req.body;
  if (!date || !description || amount === undefined || amount === null || !type || !category)
    return res.status(400).json({ error: "Missing required fields" });
  if (!["income", "expense"].includes(type))
    return res.status(400).json({ error: "Invalid type" });
  if (!VALID_CATEGORIES.includes(category))
    return res.status(400).json({ error: "Invalid category" });
  const created = await createTransaction({
    date, description, amount, type, category, reference,
    sortOrder: sort_order, createdById: req.user.id, createdByName: req.user.name,
  });
  res.status(201).json(created);
}));

// ── Update transaction (treasurer only) ──────────────────────────────────────
router.put("/transactions/:id", requireAuth, requireRole("treasurer"), wrap(async (req, res) => {
  const { date, description, amount, type, category, reference, sort_order } = req.body;
  if (!VALID_CATEGORIES.includes(category))
    return res.status(400).json({ error: "Invalid category" });
  const updated = await updateTransaction({
    id: req.params.id, date, description, amount, type, category, reference, sortOrder: sort_order,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
}));

// ── Delete transaction (treasurer only) ──────────────────────────────────────
router.delete("/transactions/:id", requireAuth, requireRole("treasurer"), wrap(async (req, res) => {
  const deletedId = await deleteTransaction(req.params.id);
  if (deletedId === undefined) return res.status(404).json({ error: "Not found" });
  res.json({ deleted: deletedId });
}));

// ── Aggregated report data ────────────────────────────────────────────────────
router.get("/reports", wrap(async (req, res) => {
  const { from, to } = req.query;
  res.json(await getReport({ from, to }));
}));

// ── Expenses (recurring) ─────────────────────────────────────────────────────
router.get("/expenses", wrap(async (req, res) => {
  res.json(await listExpenses());
}));

// ── Error handler for this router ─────────────────────────────────────────────
router.use((err, req, res, _next) => {
  console.error("[finances]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default router;
