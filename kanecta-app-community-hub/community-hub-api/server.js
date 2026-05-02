import express from "express";
import { createServer } from "http";
import { Server as SocketIO } from "socket.io";
import discussionsRouter from "./routes/discussions.js";
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

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Featherston API running on port ${PORT}`);
});

export { app, httpServer };
