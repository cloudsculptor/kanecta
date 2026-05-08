import { Router } from "express";
import pool from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

const VALID_CATEGORIES = [
  "membership", "donation", "grant", "interest", "other_income",
  "hosting", "domain", "software", "administration", "legal",
  "insurance", "bank_charges", "events", "other_expense",
];

const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);

// ── List transactions (any authenticated user) ────────────────────────────────
router.get("/transactions", requireAuth, wrap(async (req, res) => {
  const { from, to } = req.query;
  let query = "SELECT * FROM finances_transactions";
  const params = [];
  const conditions = [];
  if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
  if (to)   { params.push(to);   conditions.push(`date <= $${params.length}`); }
  if (conditions.length) query += " WHERE " + conditions.join(" AND ");
  query = `
    SELECT t.*, COUNT(tf.file_id)::int AS file_count
    FROM (${query}) t
    LEFT JOIN finances_transaction_files tf ON tf.transaction_id = t.id
    GROUP BY t.id, t.date, t.description, t.amount, t.type, t.category,
             t.reference, t.sort_order, t.created_by_id, t.created_by_name,
             t.created_at, t.updated_at, t.uuid
    ORDER BY t.date ASC, t.sort_order ASC, t.id ASC
  `;
  const { rows } = await pool.query(query, params);
  res.json(rows);
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
  const { rows } = await pool.query(
    `INSERT INTO finances_transactions
       (date, description, amount, type, category, reference, sort_order, created_by_id, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [date, description, amount, type, category, reference || null, sort_order ?? 0,
     req.user.id, req.user.name]
  );
  res.status(201).json(rows[0]);
}));

// ── Update transaction (treasurer only) ──────────────────────────────────────
router.put("/transactions/:id", requireAuth, requireRole("treasurer"), wrap(async (req, res) => {
  const { date, description, amount, type, category, reference, sort_order } = req.body;
  if (!VALID_CATEGORIES.includes(category))
    return res.status(400).json({ error: "Invalid category" });
  const { rows } = await pool.query(
    `UPDATE finances_transactions
     SET date=$1, description=$2, amount=$3, type=$4, category=$5, reference=$6, sort_order=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [date, description, amount, type, category, reference || null, sort_order ?? 0, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json(rows[0]);
}));

// ── Delete transaction (treasurer only) ──────────────────────────────────────
router.delete("/transactions/:id", requireAuth, requireRole("treasurer"), wrap(async (req, res) => {
  const { rows } = await pool.query(
    "DELETE FROM finances_transactions WHERE id=$1 RETURNING id", [req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: "Not found" });
  res.json({ deleted: rows[0].id });
}));

// ── Aggregated report data ────────────────────────────────────────────────────
router.get("/reports", requireAuth, wrap(async (req, res) => {
  const { from, to } = req.query;
  const params = [];
  const conditions = [];
  if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
  if (to)   { params.push(to);   conditions.push(`date <= $${params.length}`); }
  const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
  const { rows } = await pool.query(
    `SELECT type, category, SUM(amount)::NUMERIC(10,2) AS total
     FROM finances_transactions ${where}
     GROUP BY type, category ORDER BY type, category`,
    params
  );
  res.json(rows);
}));

// ── Error handler for this router ─────────────────────────────────────────────
router.use((err, req, res, _next) => {
  console.error("[finances]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default router;
