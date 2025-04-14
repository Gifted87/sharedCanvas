Welcome to **Shared Canvas Host**, a collaborative canvas application designed to enable real-time sharing and interaction across multiple devices on the same local network. This app is built using **Electron**, **Node.js**, and **Socket.IO**, and provides a seamless experience for sharing files, images, text, and more in a shared workspace.

---

## Table of Contents

1. Features
2. Installation
3. Usage
4. System Requirements
5. Application Structure
6. How It Works
7. Troubleshooting
8. Contributing
9. License

---

## Features

- **Collaborative Canvas**: Share a canvas with multiple devices connected to the same local network.
- **Real-Time Updates**: Changes made by one user are instantly reflected on all connected devices.
- **File Uploads**: Drag and drop files or upload them directly to the canvas.
- **Text and Image Support**: Add text, images, and files to the canvas with ease.
- **Bookmarks**: Save and navigate to specific sections of the canvas.
- **Minimap**: View the entire canvas and navigate quickly using the minimap.
- **Search and Filter**: Search for items by name, tags, or type.
- **Tag Management**: Add, edit, and remove tags for better organization.
- **Offline-First Design**: Works without an internet connection; only requires a local network.
- **Cross-Device Compatibility**: Access the canvas from any device with a browser by scanning a QR code or entering the local IP address.
- **History Navigation**: Undo and redo navigation actions with history buttons.

---

## Installation

### Prerequisites

- **Node.js** (v14 or later) and **npm** installed on your system.
- A local network connection (Wi-Fi or Ethernet).

### Steps

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-username/shared-canvas-host.git
   cd shared-canvas-host
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Run the Application**:
   ```bash
   npm start
   ```

4. **Build the Application** (Optional):
   To create a distributable version of the app:
   ```bash
   npm run build
   ```

---

## Usage

### Starting the Application

1. Launch the app by running `npm start` or by opening the executable if you’ve built the app.
2. Upon startup, the app will check for an active local network connection. If no network is detected, the app will display an error and exit.

### Connecting Devices

1. Once the app is running, it will display a QR code and a local IP address (e.g., `http://192.168.1.100:3000`).
2. Other devices on the same network can connect by:
   - Scanning the QR code.
   - Entering the IP address in their browser.

### Interacting with the Canvas

- **Add Items**:
  - Drag and drop files onto the canvas.
  - Use the "Paste" button to add text.
  - Use the "Upload" button to add files.
- **Move and Resize**:
  - Drag items to reposition them.
  - Resize items by dragging their edges (if supported).
- **Tag Management**:
  - Right-click an item and select "Edit Tags" to add or remove tags.
- **Search and Filter**:
  - Use the search bar to find items by name or tags.
- **Bookmarks**:
  - Save the current view using the "Save View" button.
  - Navigate to saved views using the bookmarks dropdown.

### Exiting the Application

- Close the app window to exit.
- The app will automatically save the canvas state and clean up temporary files.

---

## System Requirements

- **Operating System**:
  - Windows 10 or later
  - macOS 10.15 or later
  - Linux (tested on Ubuntu 20.04)
- **Hardware**:
  - Minimum 4GB RAM
  - Dual-core processor
- **Network**:
  - Local network connection (Wi-Fi or Ethernet)

---

## Application Structure

The app is organized into the following key components:

### Main Process

- **`index.js`**:
  - Handles the Electron app lifecycle.
  - Manages the main application window.
  - Starts the embedded Node.js server.

### Server

- **`server.js`**:
  - Manages the backend logic using Express and Socket.IO.
  - Handles file uploads, state persistence, and real-time communication.

### Renderer Process

- **`public/index.html`**:
  - The main HTML file for the app's frontend.
- **`public/client.js`**:
  - Contains the client-side JavaScript for canvas interactions, socket communication, and UI updates.
- **`public/style.css`**:
  - Defines the styles for the app's user interface.

### Preload Script

- **`preload.js`**:
  - Exposes safe APIs to the renderer process using Electron's `contextBridge`.

---

## How It Works

1. **Startup**:
   - The Electron app initializes and starts a local server using server.js.
   - The server serves the frontend files and handles WebSocket connections.

2. **Canvas Interaction**:
   - Users interact with the canvas through the browser or the Electron app window.
   - Actions like adding items, moving items, or editing tags are sent to the server via WebSocket.

3. **Real-Time Updates**:
   - The server broadcasts updates to all connected clients, ensuring real-time synchronization.

4. **State Persistence**:
   - The canvas state is saved to a JSON file (`canvas_state.json`) when the app exits.
   - On startup, the app loads the saved state to restore the canvas.

---

## Troubleshooting

### Common Issues

1. **No Network Connection Detected**:
   - Ensure your device is connected to a local network (Wi-Fi or Ethernet).
   - Restart the app after connecting to the network.

2. **Cannot Connect from Other Devices**:
   - Ensure all devices are on the same local network.
   - Check your firewall settings to allow connections on port `3000`.

3. **Files Not Uploading**:
   - Ensure the uploads directory exists and is writable.
   - Check the file size limit (default: 100GB).

4. **Canvas Not Loading**:
   - Check the console logs for errors.
   - Ensure the canvas_state.json file is not corrupted.

### Logs

- Logs are printed to the console for debugging purposes.
- Check the terminal or command prompt for detailed error messages.

---

## Contributing

We welcome contributions to improve **Shared Canvas Host**! Here’s how you can help:

1. Fork the repository.
2. Create a new branch for your feature or bug fix.
3. Submit a pull request with a detailed description of your changes.

### Development Scripts

- **Start the App**:
  ```bash
  npm start
  ```
- **Build the App**:
  ```bash
  npm run build
  ```
- **Lint the Code**:
  ```bash
  npm run lint
  ```

---

## License

This project is licensed under the **MIT License**. You are free to use, modify, and distribute this software, provided that the original license is included.

---

Thank you for using **Shared Canvas Host**! If you have any questions or feedback, feel free to reach out or open an issue on GitHub. Happy collaborating! 🎨