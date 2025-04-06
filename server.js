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

// --- State Management ---
let canvasItems = []; // In-memory store: {id, type, content, x, y, width?, height?, originalName?, ownerUserID?, tags?, creationDate?}
let connectedUsersMap = new Map(); // Map<socket.id, { userID: string, nickname: string }>
let userBookmarks = []; // In-memory store: { bookmarkID: string, ownerUserID: string, name: string, view: {x, y, zoom} }
let userPresenceMap = new Map(); // Map<userID, { data: object, timestamp: number }> - Stores position/view

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

// Function to get all current users {userID: nickname} for init
const getAllUsers = () => {
    const users = {};
    connectedUsersMap.forEach(userData => {
        users[userData.userID] = userData.nickname;
    });
    return users;
};

// Function to get all current presence data for init
const getAllPresence = () => {
    const presence = {};
    userPresenceMap.forEach((value, key) => {
        presence[key] = value.data; // Send only the data, not timestamp for init
    });
    return presence;
}

// --- Directory Setup ---
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
  console.log(`Created uploads directory at ${UPLOADS_DIR}`);
}

// --- Multer Setup (File Upload Handling - No change needed) ---
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
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// --- Server Start Function ---
const startServer = () => {
  // --- Middleware ---
  app.use(express.static(path.join(__dirname, "public")));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // --- HTTP Routes (No change needed) ---
  app.get("/qrcode", async (req, res) => { /* ... unchanged ... */
    try {
      const qrDataUrl = await qrcode.toDataURL(BASE_URL);
      res.json({ qrDataUrl: qrDataUrl, serverUrl: BASE_URL });
    } catch (err) {
      console.error("QR Code generation failed:", err);
      res.status(500).json({ error: "Could not generate QR code" });
    }
  });
  app.post("/upload", upload.single("file"), (req, res, next) => { /* ... unchanged ... */
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }
    res.json({
      message: "File uploaded successfully",
      filename: req.file.filename,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      path: `/uploads/${req.file.filename}`, // Relative path for client access
    });
  }, (error, req, res, next) => { /* ... multer error handler unchanged ... */
    if (error instanceof multer.MulterError) {
      console.error("Multer error:", error);
      return res.status(400).json({ error: `File upload error: ${error.message}` });
    } else if (error) {
      console.error("Unknown upload error:", error);
      return res.status(500).json({ error: "An unexpected error occurred during upload." });
    }
    next(error);
  });

  // --- Socket.IO Real-time Communication Logic ---
  io.on("connection", (socket) => {
    console.log(`User connecting: ${socket.id}`);
    // Don't increment user count or send init until nickname is set

    // Nickname Handling
    socket.on("set-nickname", (nickname) => {
        if (typeof nickname !== 'string' || nickname.trim().length === 0 || nickname.length > 30) {
            socket.emit("nickname-error", "Invalid nickname (must be 1-30 chars).");
            return;
        }
        nickname = nickname.trim();

        // Basic check for nickname uniqueness (case-insensitive)
        let isTaken = false;
        connectedUsersMap.forEach(user => {
            if (user.nickname.toLowerCase() === nickname.toLowerCase()) {
                isTaken = true;
            }
        });
        if (isTaken) {
             socket.emit("nickname-error", "Nickname is already taken.");
             return;
        }

        const userID = uuidv4();
        socket.userID = userID; // Attach userID to socket
        socket.nickname = nickname; // Attach nickname to socket

        connectedUsersMap.set(socket.id, { userID: userID, nickname: nickname });
        console.log(`User set nickname: ${nickname} (${userID}) - Socket: ${socket.id}. Total users: ${connectedUsersMap.size}`);

        // Confirm to sender
        socket.emit("nickname-set", { userID: userID, nickname: nickname });

        // Send initial state (items, users, bookmarks, presence) AFTER nickname is set
        socket.emit("init", {
            items: canvasItems,
            users: getAllUsers(), // Send {userID: nickname} map
            bookmarks: userBookmarks.filter(b => b.ownerUserID === userID), // Send only user's bookmarks
            presence: getAllPresence() // Send current presence of others
        });

        // Inform others about the new user
        socket.broadcast.emit("user-updated", { userID: userID, nickname: nickname });

        // Update user count for everyone
        io.emit("user-count", connectedUsersMap.size);
    });

    // Item Handling
    socket.on("add-item", (itemData) => {
      // Ensure user has set nickname/userID before adding items
      if (!socket.userID) {
         console.warn(`User ${socket.id} tried to add item before setting nickname.`);
         return; // Or emit an error to the client
      }

      if (
        !itemData || typeof itemData !== "object" || !itemData.type ||
        typeof itemData.content === "undefined" || typeof itemData.x !== "number" || typeof itemData.y !== "number"
      ) {
        console.warn("Received invalid item data (missing fields):", itemData);
        return;
      }

      const newItem = {
        id: uuidv4(),
        type: itemData.type,
        content: itemData.content,
        x: itemData.x,
        y: itemData.y,
        width: itemData.width, // Client might calculate initial size
        height: itemData.height,
        originalName: itemData.originalName,
        ownerUserID: socket.userID, // Use userID from the socket that sent it
        tags: [], // Initialize empty tags array
        creationDate: Date.now(), // Add creation date
        mimetype: itemData.mimetype // Store mimetype for files if available
      };

      console.log(`Adding item: ${newItem.id} (${newItem.type}) by ${socket.nickname} (${socket.userID})`);
      canvasItems.push(newItem);
      io.emit("item-added", newItem); // Broadcast the full new item including ownerUserID, tags, creationDate
    });

    socket.on("update-item", (itemUpdate) => {
       if (!socket.userID) return; // Ignore if no user identified
       if (!itemUpdate || !itemUpdate.id) return;

       const index = canvasItems.findIndex((item) => item.id === itemUpdate.id);
       if (index !== -1) {
          // --- PERMISSION CHECK (Basic Example: only owner can move) ---
          // if (canvasItems[index].ownerUserID !== socket.userID) {
          //     console.warn(`User ${socket.nickname} tried to move item ${itemUpdate.id} owned by ${canvasItems[index].ownerUserID}`);
          //     // Optionally emit an error back to the sender
          //     // socket.emit('update-error', {id: itemUpdate.id, message: "Permission denied"});
          //     return;
          // }
          // --- For now, allow anyone to move items ---

          let updatedFields = { id: itemUpdate.id }; // Always include ID
          let changed = false;

          // Update position if provided and different
          if (typeof itemUpdate.x === 'number' && canvasItems[index].x !== itemUpdate.x) {
             canvasItems[index].x = itemUpdate.x;
             updatedFields.x = itemUpdate.x;
             changed = true;
          }
          if (typeof itemUpdate.y === 'number' && canvasItems[index].y !== itemUpdate.y) {
             canvasItems[index].y = itemUpdate.y;
             updatedFields.y = itemUpdate.y;
             changed = true;
          }
          // Add width/height updates later if needed

          if (changed) {
             console.log(`Updating item: ${itemUpdate.id} pos to (${canvasItems[index].x.toFixed(0)}, ${canvasItems[index].y.toFixed(0)}) by ${socket.nickname}`);
             // Broadcast only the changed fields + ID + ownerUserID (for context)
             updatedFields.ownerUserID = canvasItems[index].ownerUserID; // Include owner
             io.emit("item-updated", updatedFields);
          }
       }
    });

    socket.on("update-item-tags", (tagUpdate) => {
        if (!socket.userID) return;
        if (!tagUpdate || !tagUpdate.id || !Array.isArray(tagUpdate.tags)) return;

        const index = canvasItems.findIndex((item) => item.id === tagUpdate.id);
        if (index !== -1) {
            // Add permission check later if needed (e.g., only owner can tag?)
            const validatedTags = tagUpdate.tags.map(tag => String(tag).trim().substring(0, 30)).filter(tag => tag.length > 0);
            canvasItems[index].tags = validatedTags;
            console.log(`Updating tags for item ${tagUpdate.id} by ${socket.nickname}:`, validatedTags);
            // Broadcast the tag update
            io.emit("item-updated", {
                id: tagUpdate.id,
                tags: validatedTags,
                ownerUserID: canvasItems[index].ownerUserID // Include owner for context
            });
        }
    });

    socket.on("delete-item", (id) => {
      if (!socket.userID) return;

      const index = canvasItems.findIndex((item) => item.id === id);
      if (index !== -1) {
        const itemToDelete = canvasItems[index];

        // Add permission check later if needed (e.g., only owner can delete?)

        // Remove item from array
        canvasItems.splice(index, 1);
        console.log(`Deleting item: ${id} by ${socket.nickname}`);
        io.emit("item-deleted", id); // Broadcast deletion ID

        // Delete associated uploaded file if applicable
        if (
          itemToDelete.type === "file" &&
          itemToDelete.content?.startsWith("/uploads/")
        ) {
          const filename = path.basename(itemToDelete.content);
          const filePath = path.join(UPLOADS_DIR, filename);
          fs.unlink(filePath, (err) => {
            if (err && err.code !== "ENOENT") {
                console.error(`Error deleting file ${filePath}:`, err);
            } else if (!err) {
                console.log(`Deleted associated file ${filePath}`);
            }
          });
        }
      } else {
        console.warn(`User ${socket.nickname} tried to delete non-existent item:`, id);
      }
    });

    socket.on("clear-canvas", () => {
      if (!socket.userID) return; // Maybe require permission later
      console.log(`Canvas cleared by ${socket.nickname}`);
      const itemsToDelete = [...canvasItems];
      canvasItems = [];
      io.emit("canvas-cleared");

      // Cleanup associated files
      itemsToDelete.forEach((item) => {
        if (item.type === "file" && item.content?.startsWith("/uploads/")) {
          const filename = path.basename(item.content);
          const filePath = path.join(UPLOADS_DIR, filename);
          fs.unlink(filePath, (err) => {
            if (err && err.code !== "ENOENT") {
                console.error(`Error deleting file ${filePath} during clear:`,err);
            }
          });
        }
      });
      console.log("Associated upload files cleanup attempted during clear.");
    });

    // Search/Filter Handling
    socket.on("filter-items", (criteria) => {
        if (!socket.userID) return;
        console.log(`Filtering request from ${socket.nickname}:`, criteria);
        const { query, filters } = criteria || {};
        const queryLower = query?.toLowerCase().trim();

        const matchingItems = canvasItems.filter(item => {
            let match = true;

            // Text Query Match (Name, Tags, Text Content)
            if (queryLower) {
                let textMatch = false;
                if (item.originalName?.toLowerCase().includes(queryLower)) textMatch = true;
                if (item.tags?.some(tag => tag.toLowerCase().includes(queryLower))) textMatch = true;
                if (item.type === 'text' && item.content?.toLowerCase().includes(queryLower)) textMatch = true;
                if (!textMatch) match = false;
            }

            // Filter Matches (Add more as needed: date, type, owner)
            if (match && filters) {
                if (filters.type && item.type !== filters.type) match = false;
                // Add date range filter logic here using item.creationDate
                // Add specific tag filter logic here using item.tags
            }

            return match;
        });

        const matchingIDs = matchingItems.map(item => item.id);
        console.log(`Found ${matchingIDs.length} items matching filter.`);
        socket.emit("filter-results", { matchingIDs });
    });

    // Bookmark Handling
    socket.on("get-bookmarks", () => {
        if (!socket.userID) return;
        const bookmarks = userBookmarks.filter(b => b.ownerUserID === socket.userID);
        socket.emit("bookmarks-updated", bookmarks); // Send user's current bookmarks
    });

    socket.on("save-bookmark", (bookmarkData) => {
        if (!socket.userID || !bookmarkData || !bookmarkData.name || !bookmarkData.view) return;

        const newBookmark = {
            bookmarkID: uuidv4(),
            ownerUserID: socket.userID,
            name: String(bookmarkData.name).trim().substring(0, 50),
            view: { // Basic validation
                x: Number(bookmarkData.view.x) || 0,
                y: Number(bookmarkData.view.y) || 0,
                zoom: Math.max(0.01, Math.min(10, Number(bookmarkData.view.zoom) || 1)),
            }
        };
        if (!newBookmark.name) return; // Name is required

        // Optional: Limit number of bookmarks per user
        userBookmarks.push(newBookmark);
        console.log(`Bookmark saved for ${socket.nickname}: ${newBookmark.name}`);

        // Send updated list back to the user
        const bookmarks = userBookmarks.filter(b => b.ownerUserID === socket.userID);
        socket.emit("bookmarks-updated", bookmarks);
    });

     // Presence Handling
    socket.on("update-presence", (presenceData) => {
        if (!socket.userID || !presenceData) return;

        userPresenceMap.set(socket.userID, {
            data: presenceData, // Store whatever client sends (e.g., {view: {...}} or {position: {...}})
            timestamp: Date.now()
        });

        // Broadcast presence update (throttling might be needed later)
        socket.broadcast.emit('presence-update', {
            userID: socket.userID,
            presenceData: presenceData
        });
    });

    // Cleanup on Disconnect
    socket.on("disconnect", () => {
      const userData = connectedUsersMap.get(socket.id);
      if (userData) {
          console.log(`User disconnected: ${userData.nickname} (${userData.userID}) - Socket: ${socket.id}`);
          connectedUsersMap.delete(socket.id);
          userPresenceMap.delete(userData.userID); // Remove presence data
          // Inform others the user left
          io.emit("user-left", { userID: userData.userID });
          // Update user count
          io.emit("user-count", connectedUsersMap.size);
      } else {
          console.log(`Socket disconnected before setting nickname: ${socket.id}`);
      }
    });
  });

  // --- Start Listening ---
  server.listen(PORT, HOST, () => {
    console.log(`Server running at ${BASE_URL}`);
    console.log(`Uploads directory: ${UPLOADS_DIR}`);
    console.log(`Point browser or scan QR code at: ${BASE_URL}`);
  });
};

// --- Cleanup Logic (No change needed) ---
const cleanupUploads = () => { /* ... unchanged ... */
  console.log("Attempting to clean up uploads directory...");
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) {
      if (err.code === 'ENOENT') console.log("Uploads directory does not exist, no cleanup needed.");
      else console.error("Error reading uploads directory for cleanup:", err);
      return;
    }
    if (!files || files.length === 0) {
      console.log("Uploads directory is empty, no cleanup needed.");
      return;
    }
    let deleteCount = 0, errorCount = 0;
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
    console.log(`Uploads cleanup finished. Deleted: ${deleteCount}, Errors: ${errorCount}.`);
  });
};

module.exports = { startServer, cleanupUploads };
