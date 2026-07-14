// Data access for the `finances` domain (transactions, reports, expenses).
// Intent-named methods own the SQL, including the dynamic date-range filtering
// and the file-count aggregation join. Category/type validation stays in the
// route (business rules, not data access). Part of the repository seam — see
// repositories/licences.js.
import pool from "../db.js";

// Transactions in a date range, each with its attached file_count.
export async function listTransactions({ from, to } = {}) {
  let inner = "SELECT * FROM finances_transactions";
  const params = [];
  const conditions = [];
  if (from) { params.push(from); conditions.push(`date >= $${params.length}`); }
  if (to)   { params.push(to);   conditions.push(`date <= $${params.length}`); }
  if (conditions.length) inner += " WHERE " + conditions.join(" AND ");
  const query = `
    SELECT t.*, COUNT(tf.file_id)::int AS file_count
    FROM (${inner}) t
    LEFT JOIN finances_transaction_files tf ON tf.transaction_id = t.id
    GROUP BY t.id, t.date, t.description, t.amount, t.type, t.category,
             t.reference, t.sort_order, t.created_by_id, t.created_by_name,
             t.created_at, t.updated_at
    ORDER BY t.date ASC, t.sort_order ASC, t.id ASC
  `;
  const { rows } = await pool.query(query, params);
  return rows;
}

export async function createTransaction({
  date, description, amount, type, category, reference, sortOrder, createdById, createdByName,
}) {
  const { rows } = await pool.query(
    `INSERT INTO finances_transactions
       (date, description, amount, type, category, reference, sort_order, created_by_id, created_by_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [date, description, amount, type, category, reference || null, sortOrder ?? 0, createdById, createdByName]
  );
  return rows[0];
}

// Returns the updated row, or undefined if no transaction has that id.
export async function updateTransaction({
  id, date, description, amount, type, category, reference, sortOrder,
}) {
  const { rows } = await pool.query(
    `UPDATE finances_transactions
     SET date=$1, description=$2, amount=$3, type=$4, category=$5, reference=$6, sort_order=$7, updated_at=NOW()
     WHERE id=$8 RETURNING *`,
    [date, description, amount, type, category, reference || null, sortOrder ?? 0, id]
  );
  return rows[0];
}

// Returns the deleted id, or undefined if no transaction has that id.
export async function deleteTransaction(id) {
  const { rows } = await pool.query(
    "DELETE FROM finances_transactions WHERE id=$1 RETURNING id", [id]
  );
  return rows[0]?.id;
}

// Totals grouped by type + category for the report view.
export async function getReport({ from, to } = {}) {
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
  return rows;
}

export async function listExpenses() {
  const { rows } = await pool.query(
    "SELECT * FROM finances_expenses ORDER BY frequency, supplier, description"
  );
  return rows;
}
