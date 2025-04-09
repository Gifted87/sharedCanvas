// preload.js
const { contextBridge, clipboard } = require("electron");

console.log("[Preload Script] Starting execution...");

try {
  // Expose specific APIs safely to the renderer process (client.js)
  contextBridge.exposeInMainWorld("electronAPI", {
    // Function to write text to the system clipboard using Electron's native module
    writeTextToClipboard: (text) => {
      try {
        // Validate input type slightly
        if (typeof text !== "string") {
          console.warn(
            "[Preload Script] writeTextToClipboard received non-string input:",
            typeof text
          );
          text = String(text); // Attempt to convert to string
        }
        console.log(
          "[Preload Script] Attempting to write text to clipboard via Electron API..."
        );
        clipboard.writeText(text);
        console.log("[Preload Script] Text successfully written to clipboard.");
        return true; // Indicate success to the renderer
      } catch (error) {
        console.error("[Preload Script] Error writing to clipboard:", error);
        return false; // Indicate failure to the renderer
      }
    },

    // You can add other functions here later if needed, e.g., for dialogs
    // testFunction: () => 'Preload API is working!'
  }); // End of exposeInMainWorld

  console.log(
    "[Preload Script] Successfully exposed 'electronAPI' to the renderer."
  );
} catch (error) {
  console.error(
    "[Preload Script] FATAL ERROR during contextBridge.exposeInMainWorld:",
    error
  );
  // If this error occurs, the API will not be available in the renderer.
}
