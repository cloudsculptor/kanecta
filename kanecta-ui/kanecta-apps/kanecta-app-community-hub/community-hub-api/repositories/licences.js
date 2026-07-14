// Data access for the `licences` domain. Intent-named methods own the SQL; the
// route handler keeps its validation/HTTP shape. Part of the repository seam
// (Phase A of the community-hub → Kanecta swap): routes depend on these methods,
// not on raw `pool.query`, so a KanectaRepository can later provide the same
// surface behind the DATA_BACKEND toggle.
import pool from "../db.js";
import { USE_KANECTA } from "./backend.js";
import * as kanecta from "./kanecta/licences.js";

export async function listLicences() {
  if (USE_KANECTA) return kanecta.listLicences();
  const { rows } = await pool.query(
    "SELECT id, name, url, public_description, private_details, badge, sort_order FROM licences ORDER BY sort_order"
  );
  return rows;
}
