// index.js
const { app, BrowserWindow } = require("electron");
const path = require("path");
const { startServer, cleanupUploads } = require("./server.js"); // Import server functions

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: false, // Disable Node.js integration in renderer for security
      contextIsolation: true, // Isolate Electron APIs from renderer code
      preload: path.join(__dirname, "preload.js"), // Load preload script
    },
  });

  // Start the embedded Node.js server (Express + Socket.IO)
  startServer();

  // Load the app's frontend from the local server
  // Use localhost as the client runs within the Electron app context
  mainWindow.loadURL("http://localhost:3000");

  // Automatically open Chrome DevTools for debugging - UNCOMMENTED
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
    // cleanupUploads(); // Cleanup is handled in 'will-quit' for better reliability
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
  console.log("Application quitting, performing cleanup...");
  cleanupUploads(); // Delete files from the 'uploads' directory
});
