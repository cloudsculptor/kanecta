import { Router } from "express";
import pool from "../db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const wrap = (fn) => (req, res, next) => fn(req, res, next).catch(next);

router.get("/", requireAuth, wrap(async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, url, public_description, private_details, badge, sort_order FROM licences ORDER BY sort_order"
  );
  res.json(rows);
}));

router.use((err, _req, res, _next) => {
  console.error("[licences]", err.message);
  res.status(500).json({ error: "Internal server error" });
});

export default router;
