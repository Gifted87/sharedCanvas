// index.js
const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require('fs'); // Required for path checking
const { startServer, cleanupUploads } = require("./server.js"); // Import server functions

let mainWindow;

function createWindow() {
  // --- Verify Preload Path ---
  const preloadPath = path.join(__dirname, "preload.js");
  console.log(`[Main Process] Resolved preload script path: ${preloadPath}`);
  try {
    const exists = fs.existsSync(preloadPath);
    console.log(`[Main Process] Does preload file exist at that path? ${exists}`);
    if (!exists) {
      // Log a prominent error if the file is missing
      console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.error(`!!! ERROR: PRELOAD SCRIPT NOT FOUND at ${preloadPath}`);
      console.error("!!! Application functionality will be broken.");
      console.error("!!! Ensure 'preload.js' is in the same directory as 'index.js'.");
      console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      // Optionally, display an error dialog to the user or prevent window creation
      // dialog.showErrorBox('Startup Error', `Cannot find required preload script: ${preloadPath}`);
      // return; // Stop window creation if preload is essential
    }
  } catch (err) {
    console.error("[Main Process] Error checking preload file existence:", err);
    // Handle error appropriately, maybe prevent window creation
  }
  // --- End Preload Path Verification ---

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // Keep Node.js integration disabled in the renderer
      contextIsolation: true, // Enable context isolation (recommended security)
      preload: preloadPath, // Use the verified path variable for the preload script
    },
  });

  // Start the embedded Node.js server (Express + Socket.IO)
  startServer();

  // Load the app's frontend from the local server
  mainWindow.loadURL("http://192.168.43.45:3000");

  // Automatically open Chrome DevTools for debugging (keep uncommented for development)
  mainWindow.webContents.openDevTools();

  mainWindow.on("closed", () => {
    // Dereference the window object when closed
    mainWindow = null;
  });
}

// --- App Lifecycle Events ---

// Create the window when Electron is ready
app.whenReady().then(createWindow);

// Quit the app when all windows are closed (except on macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // Cleanup is handled in 'will-quit' for better reliability
    app.quit();
  }
});

// Re-create the window on macOS if the dock icon is clicked and no windows are open
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Perform cleanup actions just before the application exits
app.on("will-quit", () => {
  console.log("[Main Process] Application quitting, performing cleanup...");
  cleanupUploads(); // Delete files from the 'uploads' directory
});