import express from "express";
import { createServer } from "http";
import { Server as SocketIO } from "socket.io";
import pool from "./db.js";
import discussionsRouter from "./routes/discussions.js";
import pushRouter from "./routes/push.js";
import financesRouter from "./routes/finances.js";
import pagesRouter from "./routes/pages.js";
import siteNodesRouter from "./routes/site-nodes.js";
import licencesRouter from "./routes/licences.js";
import membersRouter from "./routes/members.js";
import downloadRouter from "./routes/download.js";
import eventsRouter from "./routes/events.js";
import suggestionsRouter from "./routes/suggestions.js";
import noticesRouter from "./routes/notices.js";
import trustRouter from "./routes/trust.js";
import filesRouter from "./routes/files.js";
import { setupDiscussionsSocket } from "./socket/discussions.js";

const app = express();
const httpServer = createServer(app);

const io = new SocketIO(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || "https://featherston.co.nz",
    methods: ["GET", "POST"],
  },
});

setupDiscussionsSocket(io);

app.use(express.json());

// Attach io to every request so routes can emit events
app.use((req, res, next) => {
  req.io = io;
  next();
});

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/discussions", discussionsRouter);
app.use("/api/push", pushRouter);
app.use("/api/finances", financesRouter);
app.use("/api/pages", pagesRouter);
app.use("/api/site-nodes", siteNodesRouter);
app.use("/api/licences", licencesRouter);
app.use("/api/members", membersRouter);
app.use("/api/download", downloadRouter);
app.use("/api/events", eventsRouter);
app.use("/api/suggestions", suggestionsRouter);
app.use("/api/notices", noticesRouter);
app.use("/api/trust", trustRouter);
app.use("/api/files", filesRouter);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Featherston API running on port ${PORT}`);
});

async function shutdown() {
  httpServer.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export { app, httpServer };
