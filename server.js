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
// Paths will be set by startServer using arguments from index.js
let UPLOADS_DIR;
let STATE_FILE_PATH;

// --- State Management ---
let canvasItems = []; // In-memory store: {id, type, content, x, y, width?, height?, originalName?, ownerUserID?, tags?, creationDate?, isPinned?}
let connectedUsersMap = new Map(); // Map<socket.id, { userID: string, nickname: string }>
let userBookmarks = []; // In-memory store: { bookmarkID: string, ownerUserID: string, name: string, view: {x, y, zoom} }
let userPresenceMap = new Map(); // Map<userID, { data: object, timestamp: number }> - Stores position/view

// --- Utility Functions ---
const getLocalIP = () => {
  // Keep this function to suggest a potential IP address for remote access
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const net of iface) {
      // Ensure 'net' object is valid before accessing properties
      if (net && net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1"; // Fallback
};

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

// --- State Persistence ---
// These functions now rely on STATE_FILE_PATH being set by startServer
function loadCanvasState() {
  if (!STATE_FILE_PATH) {
      console.error("[Server] Cannot load state: STATE_FILE_PATH not initialized.");
      return;
  }
  console.log("[Server] Attempting to load canvas state...");
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      console.log(`Loading canvas state from ${STATE_FILE_PATH}...`);
      const data = fs.readFileSync(STATE_FILE_PATH, 'utf8');
      const loadedItems = JSON.parse(data);
      // Basic validation
      if (Array.isArray(loadedItems)) {
        // Ensure item properties are correctly typed/initialized after loading
        canvasItems = loadedItems.map(item => ({
            ...item,
            x: Number(item.x || 0),
            y: Number(item.y || 0),
            width: item.width ? Number(item.width) : undefined,
            height: item.height ? Number(item.height) : undefined,
            isPinned: Boolean(item.isPinned || false), // Ensure boolean
            tags: Array.isArray(item.tags) ? item.tags : [], // Ensure array
            creationDate: item.creationDate ? new Date(item.creationDate).getTime() : Date.now(), // Ensure timestamp or set now
            // Ensure ownerUserID exists, fallback perhaps? (or handle items without owner?)
            ownerUserID: item.ownerUserID || 'unknown', // Example fallback
        }));
        console.log(`[Server] Successfully loaded and validated ${canvasItems.length} items.`);
      } else {
        console.warn(`Invalid data structure in ${STATE_FILE_PATH}. Starting with empty canvas.`);
        canvasItems = [];
      }
    } else {
      console.log(`No state file found at ${STATE_FILE_PATH}. Starting with empty canvas.`);
      canvasItems = [];
    }
  } catch (error) {
    console.error(`Error loading canvas state from ${STATE_FILE_PATH}:`, error);
    console.warn("Starting with an empty canvas due to loading error.");
    canvasItems = [];
  }
}

// This function is EXPORTED and called by index.js on will-quit,
// and also used by the graceful shutdown handler here.
// It relies on STATE_FILE_PATH being set by startServer.
function saveCanvasState() {
  if (!STATE_FILE_PATH) {
      console.error("[Server] Cannot save state: STATE_FILE_PATH not initialized.");
      return;
  }
  // --- Filter for Pinned Items ---
  const itemsToSave = canvasItems
    .filter(item => item.isPinned === true) // Keep only items that are explicitly pinned
    .map(item => ({ // Map the remaining items for consistent structure
      id: item.id,
      type: item.type,
      content: item.content,
      x: Number(item.x || 0),
      y: Number(item.y || 0),
      width: item.width ? Number(item.width) : undefined,
      height: item.height ? Number(item.height) : undefined,
      originalName: item.originalName,
      ownerUserID: item.ownerUserID,
      tags: Array.isArray(item.tags) ? item.tags : [],
      creationDate: item.creationDate,
      mimetype: item.mimetype,
      isPinned: true, // We know these are all pinned
    }));

  console.log(`[Server] Attempting to save ${itemsToSave.length} pinned items (out of ${canvasItems.length} total) to ${STATE_FILE_PATH}...`);

  try {
    const data = JSON.stringify(itemsToSave, null, 2); // Stringify the filtered array

    // Ensure the directory exists before writing (useful for first run)
    const dir = path.dirname(STATE_FILE_PATH);
    if (!fs.existsSync(dir)) {
        try {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`[Server] Created directory for state file: ${dir}`);
        } catch (mkdirError) {
            console.error(`[Server] !!! FAILED to create directory for state file ${dir}:`, mkdirError);
            // Depending on severity, might want to throw or prevent saving
            return; // Stop saving if directory cannot be created
        }
    }

    // Write the file
    try {
      fs.writeFileSync(STATE_FILE_PATH, data, 'utf8');
      console.log(`[Server] Canvas state (pinned items only) saved successfully to ${STATE_FILE_PATH}.`);
    } catch (writeError) {
      console.error(`[Server] !!! FAILED to write state file to ${STATE_FILE_PATH}:`, writeError);
    }

  } catch (error) {
    console.error(`[Server] Error preparing pinned canvas state for saving:`, error);
  }
  console.log("[Server] Finished saveCanvasState execution attempt (pinned only).");
}


// --- Server Start Function ---
// Accepts paths from index.js
const startServer = (uploadsPath, stateFilePath) => {
  // --- Initialize Module Paths ---
  if (!uploadsPath || !stateFilePath) {
      console.error("[Server] CRITICAL: Uploads or State file path not provided to startServer.");
      // Throw an error to be caught by index.js
      throw new Error("Server configuration paths missing.");
  }
  UPLOADS_DIR = uploadsPath;
  STATE_FILE_PATH = stateFilePath;
  console.log(`[Server] Initialized with Uploads Dir: ${UPLOADS_DIR}`);
  console.log(`[Server] Initialized with State File: ${STATE_FILE_PATH}`);

  // --- Directory Setup ---
  // Ensure the uploads directory exists, create recursively if needed
  try {
      if (!fs.existsSync(UPLOADS_DIR)) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
          console.log(`[Server] Created uploads directory at ${UPLOADS_DIR}`);
      } else {
          console.log(`[Server] Uploads directory already exists at ${UPLOADS_DIR}`);
      }
  } catch (mkdirError) {
      console.error(`[Server] !!! FAILED to create uploads directory ${UPLOADS_DIR}:`, mkdirError);
      // Depending on severity, might want to throw or prevent server start
      throw new Error(`Failed to create required directory: ${UPLOADS_DIR}. ${mkdirError.message}`);
  }


  // --- Load Initial State ---
  loadCanvasState(); // Now uses the initialized STATE_FILE_PATH

  // --- Multer Setup (File Upload Handling) ---
  // Needs to be configured *after* UPLOADS_DIR is set
  const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      // Use the module-level variable UPLOADS_DIR
      cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
      // Keep original filename generation logic
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${uuidv4()}${path.extname(safeName) || ".dat"}`);
    },
  });
  const upload = multer({
    storage: storage,
    limits: { fileSize: 100000 * 1024 * 1024 }, // 100GB limit (adjust as needed)
  });


  // --- Middleware ---
  // Serve static frontend files (HTML, CSS, JS) from 'public' relative to THIS script
  const publicDir = path.join(__dirname, "public");
  console.log(`[Server] Serving static files from: ${publicDir}`);
  if (!fs.existsSync(publicDir)) {
      console.warn(`[Server] WARNING: Public directory not found at ${publicDir}. Frontend will likely not load.`);
      // Might want to throw an error here if frontend is essential
      // throw new Error(`Public directory missing: ${publicDir}`);
  }
  app.use(express.static(publicDir));

  // Serve uploaded files from the user data uploads directory
  console.log(`[Server] Serving uploaded files from: ${UPLOADS_DIR}`);
  app.use("/uploads", express.static(UPLOADS_DIR));


  // --- HTTP Routes ---
  const HOST_FOR_URL = getLocalIP(); // Use for display/QR code
  const BASE_URL = `http://${HOST_FOR_URL}:${PORT}`;

  app.get("/qrcode", async (req, res) => {
    try {
      const qrDataUrl = await qrcode.toDataURL(BASE_URL);
      res.json({ qrDataUrl: qrDataUrl, serverUrl: BASE_URL });
    } catch (err) {
      console.error("QR Code generation failed:", err);
      res.status(500).json({ error: "Could not generate QR code" });
    }
  });

  // Upload route using the configured multer instance
  app.post("/upload", upload.single("file"), (req, res, next) => {
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
  }, (error, req, res, next) => { // Multer error handler
    if (error instanceof multer.MulterError) {
      console.error("Multer error:", error);
      return res.status(400).json({ error: `File upload error: ${error.message}` });
    } else if (error) {
      console.error("Unknown upload error:", error);
      return res.status(500).json({ error: "An unexpected error occurred during upload." });
    }
    next(error); // Should not happen if previous checks cover all
  });

  // --- Socket.IO Real-time Communication Logic ---
  io.on("connection", (socket) => {
    console.log(`[Socket.IO] User connecting: ${socket.id}`);
    // Client needs to send 'set-nickname' or 're-identify'

    // Nickname Handling (initial join)
    socket.on("set-nickname", (nickname) => {
      if (socket.userID) {
        console.warn(`[Socket.IO] User ${socket.nickname} (${socket.userID}) tried to set nickname again.`);
        return; // Already identified
      }
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
        socket.emit("nickname-error", "Name is already taken.");
        return;
      }

      const userID = uuidv4();
      socket.userID = userID; // Attach userID to socket
      socket.nickname = nickname; // Attach nickname to socket

      connectedUsersMap.set(socket.id, { userID: userID, nickname: nickname });
      console.log(`[Socket.IO] User set nickname: ${nickname} (${userID}) - Socket: ${socket.id}. Total users: ${connectedUsersMap.size}`);

      // Confirm to sender
      socket.emit("nickname-set", { userID: userID, nickname: nickname });

      // Send initial state AFTER nickname is set
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

    // Reconnection Handling
    socket.on('re-identify', (data) => {
       if (socket.userID) {
        console.warn(`[Socket.IO] Already identified User ${socket.nickname} (${socket.userID}) sent re-identify.`);
        return; // Already identified
      }
      if (!data || !data.storedUserID || !data.storedNickname) {
        console.warn(`[Socket.IO] Invalid re-identify attempt from socket ${socket.id}. Forcing new join.`);
        // Optionally tell client to start fresh (e.g., clear local storage and show nickname prompt)
        // socket.emit('force-refresh', { message: "Re-identification failed. Please rejoin." });
        return; // Let client handle showing nickname prompt again
      }

      const { storedUserID, storedNickname } = data;
      console.log(`[Socket.IO] Re-identify attempt: Nick=[${storedNickname}], ID=[${storedUserID}], New Socket=[${socket.id}]`);

      // --- Verification ---
      // 1. Check if another ACTIVE socket is already using this userID
      let alreadyActiveSocketId = null;
      for (const [sid, uData] of connectedUsersMap.entries()) {
        if (uData.userID === storedUserID) {
          alreadyActiveSocketId = sid;
          break; // Found an active socket with this ID
        }
      }

      if (alreadyActiveSocketId && alreadyActiveSocketId !== socket.id) {
        console.warn(`[Socket.IO] User ID ${storedUserID} (${storedNickname}) is already active with socket ${alreadyActiveSocketId}. Rejecting re-identify for ${socket.id}.`);
        // Disconnect the new socket trying to use the occupied ID
        socket.emit("reconnect-error", "This user account is already connected from another session.");
        socket.disconnect(true);
        return;
      }

      // --- Success ---
      console.log(`[Socket.IO] Re-identifying socket ${socket.id} as User ${storedNickname} (${storedUserID})`);
      socket.userID = storedUserID;
      socket.nickname = storedNickname;

      // If the user was previously disconnected but is now re-identifying with the *same* socket ID
      // (less common, usually a new socket ID), update the map entry.
      // If it's a new socket ID, add it.
      connectedUsersMap.set(socket.id, { userID: storedUserID, nickname: storedNickname });

       // Check if they were already present just before disconnecting (handle quick reconnects)
      const wasPresent = Array.from(connectedUsersMap.values()).some(u => u.userID === storedUserID);

      // Send state back to the reconnected client
      socket.emit("init", {
        items: canvasItems,
        users: getAllUsers(),
        bookmarks: userBookmarks.filter(b => b.ownerUserID === storedUserID),
        presence: getAllPresence()
      });

       // Inform others the user is back (use 'user-updated') only if they weren't already marked present
       if (!wasPresent) {
            socket.broadcast.emit("user-updated", { userID: storedUserID, nickname: storedNickname });
       } else {
           console.log(`[Socket.IO] User ${storedNickname} reconnected quickly, maybe no broadcast needed.`);
           // Still good to send state to the user directly via init
       }

      // Update user count (might not change, but good practice)
      io.emit("user-count", connectedUsersMap.size);

      // Client should send an 'update-presence' soon after init
    });


    // Item Handling
    socket.on("add-item", (itemData) => {
      if (!socket.userID || !socket.nickname) {
        console.warn(`[Socket.IO] Add item attempt from unidentified socket ${socket.id}.`);
        socket.emit("action-error", { message: "You must set a nickname before adding items." });
        return;
      }

      if (
        !itemData || typeof itemData !== "object" || !itemData.type ||
        typeof itemData.content === "undefined" || typeof itemData.x !== "number" || typeof itemData.y !== "number"
      ) {
        console.warn("[Socket.IO] Received invalid item data (missing/wrong fields):", itemData);
        socket.emit("action-error", { message: "Invalid item data received." });
        return;
      }

      const newItem = {
        id: uuidv4(),
        type: String(itemData.type).substring(0, 20), // Basic sanitization
        content: itemData.content, // Further validation/sanitization might be needed based on type
        x: Number(itemData.x),
        y: Number(itemData.y),
        width: itemData.width ? Number(itemData.width) : undefined,
        height: itemData.height ? Number(itemData.height) : undefined,
        originalName: itemData.originalName ? String(itemData.originalName).substring(0, 255) : undefined,
        ownerUserID: socket.userID,
        tags: [], // Initialize empty tags array
        creationDate: Date.now(),
        mimetype: itemData.mimetype ? String(itemData.mimetype).substring(0, 100) : undefined,
        isPinned: false // New items start unpinned
      };

      console.log(`[Socket.IO] Adding item: ${newItem.id} (${newItem.type}) by ${socket.nickname} (${socket.userID})`);
      canvasItems.push(newItem);
      io.emit("item-added", newItem); // Broadcast the full new item
    });

    socket.on("toggle-pin-item", (id) => {
      if (!socket.userID) return;

      const index = canvasItems.findIndex((item) => item.id === id);
      if (index !== -1) {
        // Add permission check later if needed (e.g., roles, admins)
        const item = canvasItems[index];
        item.isPinned = !item.isPinned; // Toggle the pin status

        console.log(`[Socket.IO] Item ${item.id} pin status toggled to ${item.isPinned} by ${socket.nickname}`);

        // Broadcast the update (id, isPinned, and owner for context)
        io.emit("item-updated", {
          id: item.id,
          isPinned: item.isPinned,
          ownerUserID: item.ownerUserID // Include owner for potential client-side logic
        });
      } else {
        console.warn(`[Socket.IO] User ${socket.nickname} tried to toggle pin on non-existent item: ${id}`);
        socket.emit("action-error", { message: "Item not found."});
      }
    });

    socket.on("update-item", (itemUpdate) => {
      if (!socket.userID) return;
      if (!itemUpdate || !itemUpdate.id) return;

      const index = canvasItems.findIndex((item) => item.id === itemUpdate.id);
      if (index !== -1) {
        // --- Optional Permission Check ---
        // if (canvasItems[index].ownerUserID !== socket.userID && !/* userIsAdmin(socket.userID) */) {
        //     console.warn(`[Socket.IO] Permission denied: User ${socket.nickname} tried to move item ${itemUpdate.id} owned by ${canvasItems[index].ownerUserID}`);
        //     socket.emit('action-error', {id: itemUpdate.id, message: "Permission denied to modify this item."});
        //     return;
        // }
        // --- Currently allows anyone to move items ---

        const currentItem = canvasItems[index];
        let updatedFields = { id: itemUpdate.id }; // Always include ID
        let changed = false;

        // Update position if provided and different
        if (typeof itemUpdate.x === 'number' && currentItem.x !== itemUpdate.x) {
          currentItem.x = itemUpdate.x;
          updatedFields.x = itemUpdate.x;
          changed = true;
        }
        if (typeof itemUpdate.y === 'number' && currentItem.y !== itemUpdate.y) {
          currentItem.y = itemUpdate.y;
          updatedFields.y = itemUpdate.y;
          changed = true;
        }
        // Update size if provided and different (ensure numbers)
        if (typeof itemUpdate.width === 'number' && currentItem.width !== itemUpdate.width) {
           currentItem.width = itemUpdate.width;
           updatedFields.width = itemUpdate.width;
           changed = true;
        }
        if (typeof itemUpdate.height === 'number' && currentItem.height !== itemUpdate.height) {
           currentItem.height = itemUpdate.height;
           updatedFields.height = itemUpdate.height;
           changed = true;
        }
        // Add other updatable fields like content for text items if needed

        if (changed) {
          console.log(`[Socket.IO] Updating item: ${itemUpdate.id} by ${socket.nickname}`);
          updatedFields.ownerUserID = currentItem.ownerUserID; // Include owner for context
          io.emit("item-updated", updatedFields);
        }
      } else {
         console.warn(`[Socket.IO] User ${socket.nickname} tried to update non-existent item: ${itemUpdate.id}`);
         // Don't necessarily need to notify user unless update was critical
      }
    });

    socket.on("update-item-tags", (tagUpdate) => {
      if (!socket.userID) return;
      if (!tagUpdate || !tagUpdate.id || !Array.isArray(tagUpdate.tags)) return;

      const index = canvasItems.findIndex((item) => item.id === tagUpdate.id);
      if (index !== -1) {
        // Add permission check later if needed
        const validatedTags = tagUpdate.tags
            .map(tag => String(tag).trim().substring(0, 30)) // Sanitize: string, trim, max length
            .filter(tag => tag.length > 0) // Remove empty tags
            .filter((tag, idx, self) => self.indexOf(tag) === idx); // Ensure uniqueness

        canvasItems[index].tags = validatedTags;
        console.log(`[Socket.IO] Updating tags for item ${tagUpdate.id} by ${socket.nickname}:`, validatedTags);
        // Broadcast the tag update
        io.emit("item-updated", {
          id: tagUpdate.id,
          tags: validatedTags,
          ownerUserID: canvasItems[index].ownerUserID // Include owner for context
        });
      } else {
        console.warn(`[Socket.IO] User ${socket.nickname} tried to update tags on non-existent item: ${tagUpdate.id}`);
        socket.emit("action-error", { message: "Item not found."});
      }
    });

    socket.on("delete-item", (id) => {
      if (!socket.userID) return;

      const index = canvasItems.findIndex((item) => item.id === id);
      if (index !== -1) {
        const itemToDelete = canvasItems[index];

        // --- Permission Check ---
        if (itemToDelete.isPinned) {
          console.warn(`[Socket.IO] User ${socket.nickname} tried to delete pinned item: ${id}. Operation denied.`);
          socket.emit("action-error", { message: "Cannot delete a pinned item. Unpin it first." });
          return; // Stop deletion
        }
        // Add role-based check later if needed (e.g., only owner or admin can delete)
        // if (itemToDelete.ownerUserID !== socket.userID && !/* userIsAdmin(socket.userID) */ ) {
        //     console.warn(`[Socket.IO] Permission denied: User ${socket.nickname} tried to delete item ${id} owned by ${itemToDelete.ownerUserID}`);
        //     socket.emit("action-error", { message: "You do not have permission to delete this item." });
        //     return;
        // }
        // --- Currently allows deletion if not pinned ---

        // Remove item from array
        canvasItems.splice(index, 1);
        console.log(`[Socket.IO] Deleting item: ${id} by ${socket.nickname}`);
        io.emit("item-deleted", id); // Broadcast deletion ID

        // Delete associated uploaded file if applicable
        // Use UPLOADS_DIR which is now correctly set
        if (
          itemToDelete.type === "file" &&
          itemToDelete.content?.startsWith("/uploads/") &&
          UPLOADS_DIR // Ensure UPLOADS_DIR is set
        ) {
          const filename = path.basename(itemToDelete.content);
          const filePath = path.join(UPLOADS_DIR, filename);
          fs.unlink(filePath, (err) => {
            if (err && err.code !== "ENOENT") { // Ignore "file not found" errors
              console.error(`[Server] Error deleting associated file ${filePath}:`, err);
            } else if (!err) {
              console.log(`[Server] Deleted associated file ${filePath}`);
            } else {
               console.log(`[Server] Associated file ${filePath} not found for deleted item ${id}.`);
            }
          });
        }
      } else {
        console.warn(`[Socket.IO] User ${socket.nickname} tried to delete non-existent item:`, id);
        // No need to notify user usually
      }
    });

    socket.on("clear-canvas", () => {
      if (!socket.userID) return; // Maybe require admin permission later

      console.log(`[Socket.IO] Canvas clear requested by ${socket.nickname}. Pinned items will remain.`);

      const itemsToRemove = canvasItems.filter(item => !item.isPinned);
      const itemsToKeep = canvasItems.filter(item => item.isPinned);
      const removedIDs = itemsToRemove.map(item => item.id);

      // Update server state ONLY IF items were actually removed
      if (itemsToRemove.length > 0) {
        canvasItems = itemsToKeep;

        console.log(`[Socket.IO] Canvas cleared. ${itemsToKeep.length} pinned items remain. ${itemsToRemove.length} items removed.`);

        // Signal using IDs of removed items for finer client control, or use a simple 'canvas-cleared'
        // Sending the whole state after clear might be simpler for clients.
        // io.emit("items-removed", removedIDs); // Option 1: Send removed IDs
        io.emit("canvas-cleared", { remainingItemCount: itemsToKeep.length }); // Option 2: Simple signal
        // Option 3: Send the entire remaining state (can be large but ensures sync)
        // io.emit("items-state", canvasItems);


        // Cleanup associated files ONLY for items that were actually removed
        if (UPLOADS_DIR) { // Ensure path is set
            itemsToRemove.forEach((item) => {
                if (item.type === "file" && item.content?.startsWith("/uploads/")) {
                const filename = path.basename(item.content);
                const filePath = path.join(UPLOADS_DIR, filename);
                fs.unlink(filePath, (err) => {
                    if (err && err.code !== "ENOENT") {
                        console.error(`[Server] Error deleting unpinned file ${filePath} during clear:`, err);
                    } else if (!err) {
                        console.log(`[Server] Deleted unpinned file during clear: ${filePath}`);
                    }
                });
                }
            });
            console.log("[Server] Associated unpinned upload files cleanup attempted during clear.");
        } else {
            console.warn("[Server] Cannot cleanup upload files during clear: UPLOADS_DIR not set.");
        }

      } else {
        console.log(`[Socket.IO] Canvas clear requested, but no unpinned items found.`);
        socket.emit("action-info", { message: "No unpinned items to clear." }); // Inform user nothing happened
      }
    });

    // Search/Filter Handling
    socket.on("filter-items", (criteria) => {
      if (!socket.userID) return;
      console.log(`[Socket.IO] Filtering request from ${socket.nickname}:`, criteria);
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
          // Add file type search? Maybe search mimetype if available?
          if (item.mimetype?.toLowerCase().includes(queryLower)) textMatch = true;

          if (!textMatch) match = false;
        }

        // Filter Matches (Add more as needed: date, type, owner)
        if (match && filters) {
          if (filters.type && item.type !== filters.type) match = false;
          if (filters.ownerUserID && item.ownerUserID !== filters.ownerUserID) match = false;
          if (filters.isPinned !== undefined && typeof filters.isPinned === 'boolean' && item.isPinned !== filters.isPinned) match = false;
          // Add date range filter logic here using item.creationDate
          if (filters.dateFrom && item.creationDate < filters.dateFrom) match = false;
          if (filters.dateTo && item.creationDate > filters.dateTo) match = false;
          // Add specific tag filter logic here using item.tags (match ALL specified tags?)
          if (Array.isArray(filters.tags) && filters.tags.length > 0) {
              const itemTagsLower = item.tags?.map(t => t.toLowerCase()) || [];
              const filterTagsLower = filters.tags.map(t => String(t).toLowerCase());
              if (!filterTagsLower.every(ft => itemTagsLower.includes(ft))) {
                  match = false; // Must include ALL filter tags
              }
          }
        }

        return match;
      });

      const matchingIDs = matchingItems.map(item => item.id);
      console.log(`[Socket.IO] Found ${matchingIDs.length} items matching filter.`);
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
        name: String(bookmarkData.name).trim().substring(0, 50), // Sanitize name
        view: { // Basic validation and sanitization for view
          x: Number(bookmarkData.view.x) || 0,
          y: Number(bookmarkData.view.y) || 0,
          zoom: Math.max(0.1, Math.min(5, Number(bookmarkData.view.zoom) || 1)), // Clamp zoom
        }
      };
      if (!newBookmark.name) {
          socket.emit("action-error", { message: "Bookmark name cannot be empty."});
          return;
      }

      // Optional: Limit number of bookmarks per user
      const MAX_BOOKMARKS = 50;
      const currentUserBookmarks = userBookmarks.filter(b => b.ownerUserID === socket.userID);
      if (currentUserBookmarks.length >= MAX_BOOKMARKS) {
          socket.emit("action-error", { message: `Maximum number of bookmarks (${MAX_BOOKMARKS}) reached.`});
          return;
      }

      userBookmarks.push(newBookmark);
      console.log(`[Socket.IO] Bookmark saved for ${socket.nickname}: ${newBookmark.name}`);

      // Send updated list back to the user
      const updatedBookmarks = userBookmarks.filter(b => b.ownerUserID === socket.userID);
      socket.emit("bookmarks-updated", updatedBookmarks);
    });

    socket.on("delete-bookmark", (bookmarkID) => {
        if (!socket.userID || !bookmarkID) return;

        const index = userBookmarks.findIndex(b => b.bookmarkID === bookmarkID && b.ownerUserID === socket.userID);

        if (index !== -1) {
            const deletedName = userBookmarks[index].name;
            userBookmarks.splice(index, 1);
            console.log(`[Socket.IO] Bookmark deleted for ${socket.nickname}: ${deletedName} (ID: ${bookmarkID})`);
            // Send updated list back
            const updatedBookmarks = userBookmarks.filter(b => b.ownerUserID === socket.userID);
            socket.emit("bookmarks-updated", updatedBookmarks);
        } else {
            console.warn(`[Socket.IO] User ${socket.nickname} tried to delete non-existent or unauthorized bookmark: ${bookmarkID}`);
            socket.emit("action-error", { message: "Bookmark not found or permission denied." });
        }
    });

    // Presence Handling
    socket.on("update-presence", (presenceData) => {
      if (!socket.userID || !presenceData) return;

      // Basic validation/sanitization of presence data?
      // Example: ensure view has x, y, zoom within bounds
      // For now, trust the client or keep it simple
      const validatedPresence = {
          view: {
              x: Number(presenceData.view?.x) || 0,
              y: Number(presenceData.view?.y) || 0,
              zoom: Math.max(0.1, Math.min(5, Number(presenceData.view?.zoom) || 1)),
          },
          // Add other presence info like cursor position if needed
          // cursor: { x: Number(presenceData.cursor?.x), y: Number(presenceData.cursor?.y) }
      };


      userPresenceMap.set(socket.userID, {
        data: validatedPresence,
        timestamp: Date.now()
      });

      // Broadcast presence update (throttling might be needed for high frequency)
      socket.broadcast.emit('presence-update', {
        userID: socket.userID,
        presenceData: validatedPresence
      });
    });

    // Cleanup on Disconnect
    socket.on("disconnect", (reason) => {
      const userData = connectedUsersMap.get(socket.id);
      if (userData) {
        console.log(`[Socket.IO] User disconnected: ${userData.nickname} (${userData.userID}) - Socket: ${socket.id}. Reason: ${reason}`);
        connectedUsersMap.delete(socket.id);

        // Check if this user ID has any other active sockets (unlikely with current logic, but safe check)
        let stillConnected = false;
        for(const u of connectedUsersMap.values()) {
            if (u.userID === userData.userID) {
                stillConnected = true;
                break;
            }
        }

        // If no other sockets are active for this user ID, remove presence and notify others
        if (!stillConnected) {
            userPresenceMap.delete(userData.userID); // Remove presence data
            console.log(`[Socket.IO] Removed presence for ${userData.nickname} (${userData.userID})`);
            // Inform others the user left
            io.emit("user-left", { userID: userData.userID });
        } else {
            console.log(`[Socket.IO] User ${userData.nickname} (${userData.userID}) still has other connections active.`);
        }

        // Update user count regardless
        io.emit("user-count", connectedUsersMap.size);
      } else {
        console.log(`[Socket.IO] Unidentified socket disconnected: ${socket.id}. Reason: ${reason}`);
      }
    });
  });

  // --- Start Listening ---
  // Bind to 0.0.0.0 to accept connections on all available network interfaces
  // This is generally better for accessibility than binding to a specific IP
  const BIND_HOST = '0.0.0.0';
  server.listen(PORT, BIND_HOST, () => {
    const displayIP = getLocalIP(); // Get local IP just for display
    console.log(`[Server] Server running.`);
    console.log(`[Server] Listening on: ${BIND_HOST}:${PORT}`);
    console.log(`[Server] Access locally via: http://localhost:${PORT}`);
    console.log(`[Server] Access on network (likely): http://${displayIP}:${PORT}`);
    console.log(`[Server] Uploads directory: ${UPLOADS_DIR}`);
    console.log(`[Server] State file: ${STATE_FILE_PATH}`);
  });

  // Handle server errors (e.g., port already in use)
  server.on('error', (error) => {
    if (error.syscall !== 'listen') {
      throw error;
    }
    const bind = typeof PORT === 'string' ? 'Pipe ' + PORT : 'Port ' + PORT;
    switch (error.code) {
      case 'EACCES':
        console.error(`[Server] ${bind} requires elevated privileges`);
        process.exit(1);
        break;
      case 'EADDRINUSE':
        console.error(`[Server] ${bind} is already in use`);
        process.exit(1);
        break;
      default:
        throw error;
    }
  });

}; // End of startServer function

// --- Cleanup Logic ---
// This function is EXPORTED and called by index.js on will-quit
// It relies on UPLOADS_DIR being set by startServer.
const cleanupUploads = () => {
  if (!UPLOADS_DIR) {
    console.warn("[Server] Cannot cleanup uploads: UPLOADS_DIR not initialized.");
    return;
  }
  console.log("[Server] Attempting to clean up uploads directory:", UPLOADS_DIR);
  fs.readdir(UPLOADS_DIR, (err, files) => {
    if (err) {
      // If the directory doesn't exist, that's fine for cleanup.
      if (err.code === 'ENOENT') {
        console.log("[Server] Uploads directory does not exist, no cleanup needed.");
      } else {
        // Log other errors (e.g., permission issues)
        console.error("[Server] Error reading uploads directory for cleanup:", err);
      }
      return;
    }

    if (!files || files.length === 0) {
      console.log("[Server] Uploads directory is empty, no cleanup needed.");
      return;
    }

    let deleteCount = 0;
    let errorCount = 0;
    console.log(`[Server] Found ${files.length} files to potentially delete...`);

    files.forEach((file) => {
      // Optional: Add checks here if some files should *not* be deleted
      // e.g., based on filename patterns, creation date, etc.
      const filePath = path.join(UPLOADS_DIR, file);
      try {
        fs.unlinkSync(filePath);
        // console.log(`[Server] Deleted file: ${filePath}`); // Verbose logging
        deleteCount++;
      } catch (unlinkErr) {
        console.error(`[Server] Error deleting file ${filePath}:`, unlinkErr);
        errorCount++;
      }
    });
    console.log(`[Server] Uploads cleanup finished. Deleted: ${deleteCount}, Errors: ${errorCount}.`);
  });
};

// --- Graceful Shutdown Handling (within Server) ---
// This attempts to save state when the Node.js process receives termination signals.
function handleShutdown(signal) {
  console.log(`\n[Server] Received ${signal}. Initiating graceful shutdown...`);

  // 1. Stop accepting new connections
  console.log("[Server] Closing HTTP/Socket.IO server...");
  server.close((err) => {
    if (err) {
      console.error("[Server] Error closing HTTP server:", err);
    } else {
      console.log("[Server] HTTP server closed.");
    }

    // 2. Close Socket.IO connections (optional, server.close often handles this)
    io.close(() => {
      console.log("[Server] Socket.IO connections closed.");
      // 3. Save state *after* server is closed
      console.log("[Server] Saving final canvas state...");
      saveCanvasState(); // Uses the module-level STATE_FILE_PATH

      console.log("[Server] Graceful shutdown sequence completed. Exiting process.");
      process.exit(0); // Exit cleanly
    });
  });

  // Force exit after a timeout if graceful shutdown hangs
  const shutdownTimeout = 5000; // 5 seconds
  setTimeout(() => {
    console.error("[Server] Graceful shutdown timed out. Forcing exit.");
    // Attempt one last save just in case
    try { saveCanvasState(); } catch(e) { console.error("Error during forced save:", e); }
    process.exit(1); // Exit with error code
  }, shutdownTimeout);
}

// Listen for common termination signals
process.on('SIGINT', () => handleShutdown('SIGINT')); // Ctrl+C
process.on('SIGTERM', () => handleShutdown('SIGTERM')); // Termination request
process.on('SIGQUIT', () => handleShutdown('SIGQUIT')); // Quit request

// --- Exports ---
// Export functions needed by index.js
module.exports = {
  startServer,
  cleanupUploads, // Still needed for will-quit fallback
  saveCanvasState, // Still needed for will-quit fallback
  getLocalIP // Still useful for display
};