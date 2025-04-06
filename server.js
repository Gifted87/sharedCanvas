// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const qrcode = require("qrcode");
const os = require("os");
const fs = require("fs");
const path = require("path");
const multer = require("multer"); // Handles file uploads
const { v4: uuidv4 } = require("uuid"); // Generates unique IDs

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- Configuration ---
const PORT = 3000;
const UPLOADS_DIR = path.join(__dirname, "uploads");
let canvasItems = []; // In-memory store for canvas item data {id, type, content, x, y, ...}
let connectedUsers = 0; // Track connected users

// --- Utility Functions ---
const getLocalIP = () => {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const net of iface) {
      if (net && net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return "127.0.0.1"; // Fallback
};

const HOST = getLocalIP();
const BASE_URL = `http://${HOST}:${PORT}`;

// --- Directory Setup ---
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
  console.log(`Created uploads directory at ${UPLOADS_DIR}`);
}

// --- Multer Setup (File Upload Handling) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${uuidv4()}${path.extname(safeName) || ".dat"}`);
  },
});
const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// --- Server Start Function ---
const startServer = () => {
  // --- Middleware ---
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // --- HTTP Routes ---
  app.get("/qrcode", async (req, res) => {
    try {
      const qrDataUrl = await qrcode.toDataURL(BASE_URL);
      res.json({ qrDataUrl: qrDataUrl, serverUrl: BASE_URL });
    } catch (err) {
      console.error("QR Code generation failed:", err);
      res.status(500).json({ error: "Could not generate QR code" });
    }
  });

  app.post(
    "/upload",
    upload.single("file"),
    (req, res, next) => {
      // Added next for error handler
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded." });
      }
      res.json({
        message: "File uploaded successfully",
        filename: req.file.filename,
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        path: `/uploads/${req.file.filename}`,
      });
    },
    (error, req, res, next) => {
      // Express error handler specifically for multer
      if (error instanceof multer.MulterError) {
        console.error("Multer error:", error);
        return res
          .status(400)
          .json({ error: `File upload error: ${error.message}` });
      } else if (error) {
        console.error("Unknown upload error:", error);
        return res
          .status(500)
          .json({ error: "An unexpected error occurred during upload." });
      }
      // Fallthrough if not a multer error (shouldn't happen with upload.single)
      next(error); // Pass other errors on
    }
  );

  // --- Socket.IO Real-time Communication Logic ---
  io.on("connection", (socket) => {
    connectedUsers++;
    console.log(`User connected: ${socket.id}. Total users: ${connectedUsers}`);
    io.emit("user-count", connectedUsers);

    socket.emit("init", { items: canvasItems, users: connectedUsers });

    socket.on("add-item", (item) => {
      if (
        !item ||
        typeof item !== "object" ||
        !item.type ||
        typeof item.content === "undefined" ||
        typeof item.x !== "number" ||
        typeof item.y !== "number"
      ) {
        console.warn(
          "Received invalid item data (missing type, content, or coords):",
          item
        );
        return; // Basic validation including coordinates
      }
      item.id = uuidv4();
      console.log(
        `Adding item: ${item.id} (${item.type}) at (${item.x.toFixed(
          0
        )}, ${item.y.toFixed(0)})`
      );
      canvasItems.push(item);
      io.emit("item-added", item); // Broadcast to all
    });

    socket.on("update-item", (itemUpdate) => {
      if (!itemUpdate || !itemUpdate.id) {
        console.warn(
          "Received invalid item update data (missing id):",
          itemUpdate
        );
        return;
      }
      const index = canvasItems.findIndex((item) => item.id === itemUpdate.id);
      if (index !== -1) {
        // Only update specific allowed fields (position is primary use case)
        let updated = false;
        if (
          typeof itemUpdate.x === "number" &&
          canvasItems[index].x !== itemUpdate.x
        ) {
          canvasItems[index].x = itemUpdate.x;
          updated = true;
        }
        if (
          typeof itemUpdate.y === "number" &&
          canvasItems[index].y !== itemUpdate.y
        ) {
          canvasItems[index].y = itemUpdate.y;
          updated = true;
        }
        // Potentially add width/height later if resizing is implemented
        // if (typeof itemUpdate.width === 'number') canvasItems[index].width = itemUpdate.width;
        // if (typeof itemUpdate.height === 'number') canvasItems[index].height = itemUpdate.height;

        if (updated) {
          console.log(
            `Updating item: ${itemUpdate.id} pos to (${canvasItems[
              index
            ].x.toFixed(0)}, ${canvasItems[index].y.toFixed(0)})`
          );
          // Broadcast the updated item data to all clients (including potentially sender)
          io.emit("item-updated", canvasItems[index]);
        } else {
          // console.log(`Ignoring update for item ${itemUpdate.id} - no change detected`);
        }
      } else {
        console.warn("Attempted to update non-existent item:", itemUpdate.id);
      }
    });

    socket.on("delete-item", (id) => {
      const initialLength = canvasItems.length;
      const itemToDelete = canvasItems.find((item) => item.id === id);
      canvasItems = canvasItems.filter((item) => item.id !== id);

      if (canvasItems.length < initialLength) {
        console.log("Deleting item:", id);
        io.emit("item-deleted", id); // Broadcast deletion

        // Delete associated uploaded file if applicable
        if (
          itemToDelete &&
          itemToDelete.type === "file" &&
          itemToDelete.content?.startsWith("/uploads/")
        ) {
          const filename = path.basename(itemToDelete.content);
          const filePath = path.join(UPLOADS_DIR, filename);
          fs.unlink(filePath, (err) => {
            if (err && err.code !== "ENOENT")
              console.error(`Error deleting file ${filePath}:`, err);
            else if (!err) console.log(`Deleted associated file ${filePath}`);
          });
        }
      } else {
        console.warn("Attempted to delete non-existent item:", id);
      }
    });

    socket.on("clear-canvas", () => {
      console.log("Clearing canvas");
      const itemsToDelete = [...canvasItems];
      canvasItems = [];
      io.emit("canvas-cleared");

      itemsToDelete.forEach((item) => {
        if (item.type === "file" && item.content?.startsWith("/uploads/")) {
          const filename = path.basename(item.content);
          const filePath = path.join(UPLOADS_DIR, filename);
          fs.unlink(filePath, (err) => {
            if (err && err.code !== "ENOENT")
              console.error(
                `Error deleting file ${filePath} during clear:`,
                err
              );
          });
        }
      });
      console.log("Associated upload files cleanup attempted during clear.");
    });

    socket.on("disconnect", () => {
      connectedUsers--;
      if (connectedUsers < 0) connectedUsers = 0;
      console.log(
        `User disconnected: ${socket.id}. Total users: ${connectedUsers}`
      );
      io.emit("user-count", connectedUsers);
    });
  });

  // --- Start Listening ---
  server.listen(PORT, HOST, () => {
    console.log(`Server running at ${BASE_URL}`);
    console.log(`Uploads directory: ${UPLOADS_DIR}`);
    console.log(`Electron loads http://localhost:${PORT}`);
    console.log(`Point external browsers or scan QR code at: ${BASE_URL}`);
  });
};

// --- Cleanup Logic ---
const cleanupUploads = () => {
  console.log("Attempting to clean up uploads directory...");
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) {
      if (err.code === "ENOENT")
        console.log("Uploads directory does not exist, no cleanup needed.");
      else console.error("Error reading uploads directory for cleanup:", err);
      return;
    }
    if (!files || files.length === 0) {
      console.log("Uploads directory is empty, no cleanup needed.");
      return;
    }
    let deleteCount = 0,
      errorCount = 0;
    files.forEach((file) => {
      const filePath = path.join(UPLOADS_DIR, file);
      try {
        fs.unlinkSync(filePath);
        deleteCount++;
      } catch (unlinkErr) {
        console.error(`Error deleting file ${filePath}:`, unlinkErr);
        errorCount++;
      }
    });
    console.log(
      `Uploads cleanup finished. Deleted: ${deleteCount}, Errors: ${errorCount}.`
    );
  });
};

module.exports = { startServer, cleanupUploads };
