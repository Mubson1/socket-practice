import express from "express";
import cluster from "node:cluster";
import { createServer } from "node:http";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { createAdapter, setupPrimary } from "@socket.io/cluster-adapter";

import { dbQuery, envVariables } from "./config.js";

if (cluster.isPrimary) {
  const numCPUs = availableParallelism();

  //create one worker per available core
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork({
      PORT: parseInt(envVariables.port) + i,
    });
  }

  //set up the adapter on the primary thread
  setupPrimary();
} else {
  //open the database file
  const db = await open({
    filename: "chat.db",
    driver: sqlite3.Database,
  });

  //create 'messages' table
  await db.exec(dbQuery.createMessageTable);

  const app = express();
  const server = createServer(app);
  const io = new Server(server, {
    connectionStateRecovery: {}, //This feature will temporarily store all the events that are sent by the server and will try to restore the state of a client when it reconnects
    //set up the adapter on each worker thread
    adapter: createAdapter(),
  });

  const __dirname = dirname(fileURLToPath(import.meta.url));

  app.get("/", (req, res) => {
    res.sendFile(join(__dirname, "index.html"));
  });

  io.on("connection", async (socket) => {
    socket.on("chat message", async (msg, clientOffset, callback) => {
      let result;
      try {
        result = await db.run(dbQuery.storeInMessageTable, msg, clientOffset);
      } catch (e) {
        /* SQLITE_CONSTRAINT - The SQLITE_CONSTRAINT error code(19) means that an SQL constraint violation occurred while trying to process an SQL statement.*/
        if (e.errno === 19) {
          // the message was already inserted, so we notify the client
          callback();
        } else {
          // nothing to do, just let the client retry
        }
        return;
      }

      io.emit("chat message", msg, result.lastID);
      //acknowledge the event
      callback();
    });

    if (!socket.recovered) {
      // if the connection state recovery was not successful
      try {
        const data = await db.each(
          dbQuery.getLatestMessageContentAfterOffset,
          [socket.handshake.auth.serverOffset || 0],
          (_err, row) => {
            socket.emit("chat message", row.content, row.id);
          },
        );
      } catch (e) {
        // something went wrong
      }
    }
  });

  server.listen(envVariables.port, () => {
    console.log(`server running at http://localhost:${envVariables.port}`);
  });
}
