import pg from "pg";

const { Pool, types } = pg;

// Return DATE columns as bare 'YYYY-MM-DD' strings rather than JS Date objects.
// pg 8.x serialises Date → JSON as "2026-05-28T00:00:00.000Z" which breaks
// any client-side code that splits on '-' or appends 'T00:00:00'.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "25060"),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
});

export default pool;
