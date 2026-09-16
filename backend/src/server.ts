import { createServer } from "node:http";
import { Server } from "socket.io";
import { RoomManager } from "./rooms/RoomManager.js";
import { registerSocketHandlers } from "./socket/socketHandlers.js";

const PORT = Number(process.env.PORT ?? 3001);

const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const roomManager = new RoomManager();

registerSocketHandlers(io, roomManager);

httpServer.listen(PORT, () => {
  console.log(`Servidor de dominó escuchando en http://localhost:${PORT}`);
  console.log("Accesible en red local (CORS abierto para LAN)");
});