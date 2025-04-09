// index.js
const { app, BrowserWindow, dialog } = require("electron"); // Added dialog for potential errors
const path = require("path");
const fs = require('fs');
const os = require('os');
const { Menu } = require('electron');
// Import server functions - assuming server.js is in the same directory
const { startServer, cleanupUploads, saveCanvasState, getLocalIP } = require("./server.js");

let mainWindow;

// --- Define User Data Paths ---
// It's crucial to get these paths *after* the app is ready,
// but we define the logic here. We'll call getPath inside createWindow or later.
let userDataPath;
let uploadsPath;
let stateFilePath;

let resizeTimeout;

function initializePaths() {
  try {
    userDataPath = app.getPath('userData');
    uploadsPath = path.join(userDataPath, 'uploads');
    stateFilePath = path.join(userDataPath, 'canvas_state.json');
    console.log(`[Main Process] User Data Path: ${userDataPath}`);
    console.log(`[Main Process] Uploads Path: ${uploadsPath}`);
    console.log(`[Main Process] State File Path: ${stateFilePath}`);
  } catch (error) {
    console.error("[Main Process] !!! CRITICAL ERROR: Failed to get user data path:", error);
    // If we can't get this path, the app likely can't function.
    dialog.showErrorBox('Fatal Error', `Could not determine application data storage location. The application cannot continue.\n\nError: ${error.message}`);
    app.quit(); // Exit forcefully
    throw error; // Prevent further execution in this function
  }
}

function createApplicationMenu() {
  const template = [
    {
      label: 'Help',
      submenu: [
        {
          label: 'Show Help',
          accelerator: 'CommandOrControl+H',
          click() {
            const helpContent = `
Shared Canvas App Guide

Basic Usage:
1. Set Nickname - Enter a device name when first joining
2. Upload Files - Click the 📁 icon or drag & drop files
3. Paste Text - Use the 📝 button or Ctrl+V
4. Move Items - Click & drag any object
5. Zoom - Use +/- buttons or mouse wheel
6. Navigate - Click & drag canvas background

Advanced Features:
- Pin important items (right-click → Pin)
- Save bookmarks with current view
- Connect mobile devices via QR code
- Search content using the 🔍 icon
- Clear unpinned items with the trash icon

Common Issues:
- Can't see others: Ensure same WiFi network
- Uploads failing: Check network connection
- App not responding: Restart the app
- Laggy performance: Try closing other tabs
- Connection lost: reload the app
- App crashing: Report the issue on GitHub
            `;

            dialog.showMessageBox({
              type: 'info',
              title: 'Application Help',
              message: 'Shared Canvas User Guide',
              detail: helpContent,
              buttons: ['OK'],
              defaultId: 0
            });
          }
        },
        {
          label: 'Github',
          click() { require('electron').shell.openExternal('https://github.com/Gifted87/sharedCanvas') }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  // --- Initialize Paths (ensure app is ready) ---
  // Called here ensures app object is available
  try {
    initializePaths();
  } catch (error) {
    // Error already logged and dialog shown by initializePaths
    return; // Stop window creation if paths failed
  }

  // --- Verify Preload Path ---
  const preloadPath = path.join(__dirname, "preload.js");
  console.log(`[Main Process] Resolved preload script path: ${preloadPath}`);
  try {
    const exists = fs.existsSync(preloadPath);
    console.log(`[Main Process] Does preload file exist at that path? ${exists}`);
    if (!exists) {
      console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      console.error(`!!! ERROR: PRELOAD SCRIPT NOT FOUND at ${preloadPath}`);
      console.error("!!! Application functionality will be broken.");
      console.error("!!! Ensure 'preload.js' is in the same directory as 'index.js'.");
      console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      dialog.showErrorBox('Startup Error', `Cannot find required preload script: ${preloadPath}\nPlease ensure 'preload.js' is present and reinstall the application if necessary.`);
      // Decide if we should quit or try to continue degraded
      // return; // Uncomment to stop window creation if preload is essential
    }
  } catch (err) {
    console.error("[Main Process] Error checking preload file existence:", err);
    dialog.showErrorBox('Startup Error', `An error occurred while checking for the preload script: ${err.message}`);
    // return; // Stop window creation
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

  mainWindow.on('resize', () => {
    // Clear the previous timeout if it exists
    clearTimeout(resizeTimeout);
    // Set a new timeout to reload after a short delay (e.g., 500ms)
    resizeTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log('[Main Process] Window resize finished, reloading web contents...');
        mainWindow.webContents.reload();
      }
    }, 500); // Adjust delay (in milliseconds) as needed
  });

  // Start the embedded Node.js server, passing the required paths
  // Ensure startServer can handle potential errors during its own startup
  try {
    startServer(uploadsPath, stateFilePath); // Pass paths to the server
  } catch (serverError) {
    console.error("[Main Process] !!! CRITICAL ERROR: Failed to start the internal server:", serverError);
    dialog.showErrorBox('Fatal Error', `The application's internal server failed to start. The application cannot continue.\n\nError: ${serverError.message}`);
    app.quit();
    return;
  }

  const IP = getLocalIP(); // Get the local IP address (best guess for display)
  // Load the app's frontend from the local server (running on 0.0.0.0, accessed via localhost or IP)
  // Using localhost is often more reliable for the primary window
  mainWindow.loadURL(`http://localhost:3000`);
  console.log(`[Main Process] Attempting to load URL: http://localhost:3000`);
  console.log(`[Main Process] Other devices might connect via: http://${IP}:3000 (if network allows)`);


  // --- Development Tool ---
  // Comment out for production/packaging
  // mainWindow.webContents.openDevTools();
  // ----------------------

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error(`[Main Process] Failed to load main window URL: ${errorDescription} (Code: ${errorCode})`);
    // Optional: Show error to user, maybe offer retry?
    if (!mainWindow.isDestroyed()) { // Check if window still exists
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Connection Error',
        message: 'Could not connect to the application server.',
        detail: `Please ensure the server is running correctly or try restarting the application.\n\n(Error: ${errorDescription})`
      });
    }
  });

  mainWindow.on("closed", () => {
    // Dereference the window object when closed
    mainWindow = null;
  });
}
function hasNetworkConnection() {
  const interfaces = os.networkInterfaces();
  for (const ifaceName in interfaces) {
    const ifaceList = interfaces[ifaceName];
    if (!ifaceList) continue;
    for (const iface of ifaceList) {
      // Check for IPv4 or IPv6, not internal (loopback), and not link-local temporary addresses
      if (!iface.internal && (iface.family === 'IPv4' || iface.family === 'IPv6')) {
        // Basic check: if we find any non-internal IP, assume network exists
        // More robust checks could involve pinging a known host or DNS lookup
        console.log(`[Main Process] Found active network interface: ${ifaceName} (${iface.address})`);
        return true;
      }
    }
  }
  console.warn("[Main Process] No active non-internal network interfaces found.");
  return false;
}

// --- App Lifecycle Events ---

// Create the window when Electron is ready
// Moved path initialization earlier to ensure paths are ready before window creation needs them
app.whenReady().then(() => { // <<< Modify this block
  // --- Perform Network Check BEFORE Creating Window ---
  if (!hasNetworkConnection()) {
    console.error("[Main Process] No active local network connection detected. Quitting.");
    dialog.showErrorBox('Network Error', 'An active local network connection is required to run this application. This app does not need data to run. Please connect to a network and try again.');
    app.quit(); // Exit the application
    return; // Stop further execution in this .then() block
  }
  // --- End Network Check ---

  // If network check passed, create the window
  createApplicationMenu();
  createWindow();
});

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
    if (app.isReady()) { // Ensure app is ready before creating window
      createWindow();
    } else {
      console.warn("[Main Process] Activate event received before app was ready. Waiting for whenReady.");
      // createWindow will be called by the whenReady handler
    }
  }
});

// Perform cleanup actions just before the application exits
// This ensures cleanup runs even if the server's graceful shutdown handler doesn't fire
app.on("will-quit", (event) => {
  console.log("[Main Process] Application quitting via 'will-quit', performing final cleanup...");

  // We still rely on the server module functions, which should now use the correct paths
  // initialized by startServer.

  // 1. Attempt to save state (best effort)
  // The server's graceful shutdown (SIGINT etc.) should ideally handle this,
  // but this is a fallback.
  try {
    console.log("[Main Process] Calling saveCanvasState via will-quit...");
    saveCanvasState(); // Call the imported function from server.js
    console.log("[Main Process] Call to saveCanvasState completed via will-quit.");
  } catch (err) {
    console.error("[Main Process] Error calling saveCanvasState during will-quit:", err);
    // Don't prevent quit for this error, as it might be expected if server already shut down
  }

  // 2. Cleanup uploads (optional - decide if needed on every quit)
  // Consider if cleanup should only happen manually or on specific conditions.
  // If cleanup is essential on quit, keep it. If not, it might be removed.
  // For now, keeping it as per original logic.
  try {
    console.log("[Main Process] Calling cleanupUploads via will-quit...");
    cleanupUploads(); // Delete files from the 'uploads' directory
    console.log("[Main Process] Call to cleanupUploads completed via will-quit.");
  } catch (err) {
    console.error("[Main Process] Error calling cleanupUploads during will-quit:", err);
  }

  console.log("[Main Process] Final cleanup tasks in 'will-quit' finished.");
  // No event.preventDefault() - allow the app to quit.
});