// public/client.js
// Rewritten with fixes for isPointInItem and drawPresence, and careful review of event logic.

document.addEventListener("DOMContentLoaded", () => {
  const socket = io({
    // Prevent automatic connection initially until nickname is potentially set
    // autoConnect: false // Connect immediately, but gate interaction based on myUserID
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  // --- DOM Elements ---
  const nicknameDialog = document.getElementById("nickname-dialog");
  const nicknameInput = document.getElementById("nickname-input");
  const nicknameSubmitBtn = document.getElementById("nickname-submit-btn");
  const nicknameError = document.getElementById("nickname-error");

  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false }); // Use opaque canvas for potential performance gain
  const minimapCanvas = document.getElementById("minimap-canvas"); // Minimap
  const minimapCtx = minimapCanvas.getContext("2d");

  const qrContainer = document.getElementById("qr-container");
  const qrCodeImg = document.getElementById("qr-code-img");
  const serverUrlSpan = document.getElementById("server-url");
  const qrToggleBtn = document.getElementById("qr-toggle-btn");
  const qrCloseBtn = document.getElementById("qr-close-btn");
  const userCountSpan = document.getElementById("user-count");

  const uploadBtn = document.getElementById("upload-btn");
  const fileInput = document.getElementById("file-input");
  const pasteBtn = document.getElementById("paste-btn");
  const clearCanvasBtn = document.getElementById("clear-canvas-btn");

  const searchInput = document.getElementById("search-input");
  const filterTypeBtn = document.getElementById("filter-type-btn"); // Keep reference if needed later
  const filterDateBtn = document.getElementById("filter-date-btn");
  const filterTagBtn = document.getElementById("filter-tag-btn");

  const reconnectingIndicator = document.getElementById(
    "reconnecting-indicator"
  ); // Add this
  const zoomInBtn = document.getElementById("zoom-in-btn");
  const zoomOutBtn = document.getElementById("zoom-out-btn");
  const zoomFitBtn = document.getElementById("zoom-fit-btn");
  const historyBackBtn = document.getElementById("history-back-btn");
  const historyForwardBtn = document.getElementById("history-forward-btn");
  const saveViewBtn = document.getElementById("save-view-btn");
  const bookmarksList = document.getElementById("bookmarks-list");
  const gridSnapToggle = document.getElementById("grid-snap-toggle");

  const loadingIndicator = document.getElementById("loading-indicator");
  const contextMenu = document.getElementById("context-menu");
  const deleteBtn = document.getElementById("delete-btn");
  const downloadBtn = document.getElementById("download-btn");
  const editTagsBtn = document.getElementById("edit-tags-btn"); // Context menu item for tags
  const copyTextBtn = document.getElementById("copy-text-btn");
  const pinBtn = document.getElementById("pin-btn");

  const pasteDialog = document.getElementById("paste-dialog");
  const pasteTextarea = document.getElementById("paste-textarea");
  const pasteDialogAddBtn = document.getElementById("paste-dialog-add-btn");
  const pasteDialogCancelBtn = document.getElementById(
    "paste-dialog-cancel-btn"
  );
  let textToCopy = null;
  const tagEditorDialog = document.getElementById("tag-editor-dialog");
  const tagEditorTitle = document.getElementById("tag-editor-title");
  const currentTagsContainer = document.getElementById(
    "current-tags-container"
  );
  const newTagInput = document.getElementById("new-tag-input");
  const addTagBtn = document.getElementById("add-tag-btn");
  const tagEditorDoneBtn = document.getElementById("tag-editor-done-btn");
  let currentItemForTagEditing = null;

  const toolbar = document.getElementById("toolbar"); // The main container
  const toolbarToggleBtn = document.getElementById("toolbar-toggle-btn");
  const toggleIcon = toolbarToggleBtn.querySelector(".icon"); // Get the icon span

  const bookmarkDialog = document.getElementById('bookmark-dialog');
  const bookmarkNameInput = document.getElementById('bookmark-name-input');
  const bookmarkSaveBtn = document.getElementById('bookmark-save-btn');
  const bookmarkCancelBtn = document.getElementById('bookmark-cancel-btn');
  const bookmarkError = document.getElementById('bookmark-error');

  // --- State ---
  let items = []; // Local cache of canvas items
  let myUserID = null; // Assigned by server after nickname
  let myNickname = null; // Assigned by server after nickname
  let userMap = {}; // Map: { userID: nickname } - All connected users
  let otherUsersPresence = {}; // Map: { userID: { data: {...}, timestamp: number } } - Presence data
  let bookmarks = []; // User's saved view bookmarks
  let isAttemptingReconnect = false; // Flag to track reconnect state

  let selectedItem = null; // The currently selected item object
  let draggedItem = null; // The item currently being dragged
  const imageCache = {}; // Cache for loaded image objects
  let highlightedItemIDs = new Set(); // IDs of items matching search/filter

  // --- Canvas Viewport State ---
  let zoom = 0.5; // Initial zoom level
  let offsetX = 0; // Pan offset X (screen coordinates)
  let offsetY = 0; // Pan offset Y (screen coordinates)
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 5.0;
  let isDragging = false; // Flag: currently dragging an item
  let isPanning = false; // Flag: currently panning the canvas
  let dragStartX_world, dragStartY_world; // World coords where drag started
  let itemStartX_world, itemStartY_world; // Original world coords of item being dragged
  let panStartX, panStartY; // Screen coords where pan started

  // Touch-specific state
  let pinchStartDistance = 0; // Initial distance between two fingers
  let touchCenterX = 0,
    touchCenterY = 0; // Screen center point during pinch
  let isPinching = false; // Flag: currently pinch-zooming
  let touchStartPoints = new Map(); // Store start info for each touch point

  // Navigation & Organization State
  let historyBackStack = []; // Array of {x, y, zoom} states
  let historyForwardStack = []; // Array of {x, y, zoom} states
  let isNavigatingHistory = false; // Flag to prevent history loops
  const HISTORY_DEBOUNCE = 1000; // ms to wait before recording stable view
  let historyTimeout = null; // Timer for debouncing history recording

  let isSnapEnabled = true; // Flag: grid snap enabled
  const GRID_SIZE = 20; // Size of grid cells in world units

  // --- Initial Setup ---
  // Nickname modal is shown by default via HTML/CSS

  // --- Canvas Setup ---
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Adjust canvas logical size BEFORE setting physical size
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    // Set canvas physical drawing buffer size
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    // Scale the context ONCE for the device pixel ratio
    ctx.resetTransform(); // Reset transforms before scaling
    ctx.scale(dpr, dpr);

    // Resize minimap (fixed CSS size, adjust canvas attrs for DPR)
    const miniRect = minimapCanvas.getBoundingClientRect();
    minimapCanvas.style.width = `${miniRect.width}px`;
    minimapCanvas.style.height = `${miniRect.height}px`;
    minimapCanvas.width = Math.round(miniRect.width * dpr);
    minimapCanvas.height = Math.round(miniRect.height * dpr);
    minimapCtx.resetTransform();
    minimapCtx.scale(dpr, dpr);

    console.log(
      `Canvas resized: ${canvas.width}x${canvas.height} (CSS: ${rect.width}x${rect.height}), Minimap: ${minimapCanvas.width}x${minimapCanvas.height}`
    );
    // Only redraw if initialized
    if (myUserID) {
      redrawCanvas();
      redrawMinimap();
    }
  }

  window.addEventListener("resize", resizeCanvas);
  // Initial size calculation slightly delayed to ensure layout stability
  setTimeout(resizeCanvas, 50);

  // --- Coordinate Transformations ---
  function screenToWorld(screenX, screenY) {
    // Converts screen coordinates (CSS pixels relative to canvas top-left) to world coordinates
    return {
      x: (screenX - offsetX) / zoom,
      y: (screenY - offsetY) / zoom,
    };
  }

  function worldToScreen(worldX, worldY) {
    // Converts world coordinates to screen coordinates (CSS pixels relative to canvas top-left)
    return {
      x: worldX * zoom + offsetX,
      y: worldY * zoom + offsetY,
    };
  }

  /**
 * Determines an appropriate emoji icon for a file based on its mimetype or filename.
 * Prioritizes mimetype, then falls back to filename extension, then generic mimetypes.
 * @param {string|null} mimetype The file's MIME type (e.g., 'application/pdf').
 * @param {string|null} filename The file's original name (e.g., 'report.docx').
 * @returns {string} An emoji character representing the file type.
 */
  function getIconForFile(mimetype, filename) {
    // Icon Map: Prioritize specific common types
    const FILE_ICON_MAP = {
      // MIME Types
      'application/pdf': '📕',
      'application/msword': '📘',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📘', // DOCX
      'application/vnd.ms-excel': '📗',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📗', // XLSX
      'application/vnd.ms-powerpoint': '📙',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📙', // PPTX
      'application/zip': '📦',
      'application/x-zip-compressed': '📦',
      'application/x-rar-compressed': '📦',
      'application/gzip': '📦',
      'application/x-tar': '📦',
      'text/plain': '📄',
      'text/html': '🌐',
      'text/css': '🎨',
      'text/javascript': '📜',
      'application/json': '{ }',
      'text/csv': '📊',
      // Add more specific types as needed...

      // Extensions (fallback) - Keep lowercase
      'pdf': '📕',
      'doc': '📘',
      'docx': '📘',
      'xls': '📗',
      'xlsx': '📗',
      'ppt': '📙',
      'pptx': '📙',
      'zip': '📦',
      'rar': '📦',
      'gz': '📦',
      'tar': '📦',
      'txt': '📄',
      'html': '🌐',
      'htm': '🌐',
      'css': '🎨',
      'js': '📜',
      'json': '{ }',
      'csv': '📊',
      'log': '📜',
      'xml': '</>',
      'md': '📝',
      'py': '🐍',
      'java': '☕',
      'sh': '$',
      'bat': '⚙️',
      'sql': '💾',
      'conf': '⚙️',
      'ini': '⚙️',
      'yml': '⚙️',
      'yaml': '⚙️',
    };

    const DEFAULT_FILE_ICON = '📎'; // Default: Paperclip

    // 1. Check specific mimetype
    if (mimetype && FILE_ICON_MAP[mimetype]) {
      return FILE_ICON_MAP[mimetype];
    }

    // 2. Check extension if filename provided
    if (filename) {
      // Extract extension safely, handling names with no extension or starting with '.'
      const lastDotIndex = filename.lastIndexOf('.');
      if (lastDotIndex > 0 && lastDotIndex < filename.length - 1) { // Ensure dot is not first or last char
        const extension = filename.substring(lastDotIndex + 1).toLowerCase();
        if (FILE_ICON_MAP[extension]) {
          return FILE_ICON_MAP[extension];
        }
      }
    }

    // 3. Check generic mimetype categories (as a safety net)
    if (mimetype) {
      if (mimetype.startsWith('image/')) return '🖼️'; // Generic Image
      if (mimetype.startsWith('audio/')) return '🎵'; // Generic Audio
      if (mimetype.startsWith('video/')) return '🎬'; // Generic Video
      if (mimetype.startsWith('text/')) return '📄';  // Generic Text Document
      // Note: application/* is too broad to assign a generic icon other than default
    }

    return DEFAULT_FILE_ICON; // Fallback to default icon
  }


  if (toolbar) { // Check if toolbar element exists
    toolbar.addEventListener('transitionend', (event) => {
      // Only trigger resize when the height-related transition finishes.
      // This prevents triggering resize for opacity or other unrelated transitions.
      // 'max-height' is the property used in the CSS for the collapse animation.
      if (event.propertyName === 'max-height') {
        console.log('Toolbar transition ended, resizing canvas due to height change.');
        resizeCanvas(); // Call the existing resize function to adjust canvas size and redraw
      }
    });
  } else {
    console.error("Toolbar element (#toolbar) not found for transitionend listener.");
  }

  // --- Drawing Logic ---
  function redrawCanvas() {
    if (!myUserID) return; // Don't draw if not initialized

    const dpr = window.devicePixelRatio || 1;
    // Use the logical CSS size for clearing and viewport calculations
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;

    ctx.save();
    // The initial ctx.scale(dpr, dpr) in resizeCanvas handles resolution scaling.
    // We don't need to setTransform here again unless resetting completely.

    // Clear the canvas (using logical CSS dimensions)
    ctx.fillStyle = "#e9e9e9"; // Background
    ctx.fillRect(0, 0, cssWidth, cssHeight);



    // Apply viewport transformations (pan and zoom)
    ctx.translate(offsetX, offsetY);
    ctx.scale(zoom, zoom);

    // Optional: Draw Grid if enabled (NOW USES THE TRANSFORMED CONTEXT)
    if (isSnapEnabled) {
      // Pass the original screen dimensions for calculating world bounds
      drawGrid(cssWidth, cssHeight); // <<-- ADD THE CALL HERE
    }
    // --- Draw Items ---
    items.forEach((item) => {
      const drawX = item.x || 0;
      const drawY = item.y || 0;
      const isHighlighted = highlightedItemIDs.has(item.id);
      const isSelected = selectedItem && item.id === selectedItem.id;

      // Draw selection/highlight outline first (underneath item content)
      if (isSelected || isHighlighted) {
        ctx.strokeStyle = isSelected
          ? "rgba(0, 100, 255, 0.9)" // Blue for selected
          : "rgba(255, 165, 0, 0.8)"; // Orange for highlight
        // Make line width appear consistent regardless of zoom
        ctx.lineWidth = 2 / zoom; // Adjust base thickness as needed
        const padding = 4 / zoom; // Padding based on zoom

        // Ensure width/height are valid numbers for drawing outline
        const itemWidth = typeof item.width === "number" ? item.width : 10; // Default if missing
        const itemHeight = typeof item.height === "number" ? item.height : 10;

        ctx.strokeRect(
          drawX - padding,
          drawY - padding,
          itemWidth + 2 * padding,
          itemHeight + 2 * padding
        );
      }

      // Draw item content
      try {
        switch (item.type) {
          case "text":
            drawText(item);
            break;
          case "image":
            drawImage(item);
            break;
          case "file":
            drawFile(item);
            break;
          default:
            // Draw a placeholder for unknown types?
            console.warn(`Unknown item type: ${item.type}`);
        }
      } catch (error) {
        console.error(
          `Error drawing item ${item.id} (${item.type}):`,
          error,
          item
        );
        drawErrorPlaceholder(item); // Attempt to draw error placeholder
      }

      if (item.isPinned === true) {
        drawPinIndicator(item);
      }

      // Draw Owner Nickname & Tags (common to all types, drawn on top)
      drawItemExtras(item);
    });

    // --- Draw Presence Indicators (Other Users) ---
    drawPresence();

    // Restore context to pre-transform state
    ctx.restore();

    // --- Update History (debounced) ---
    // This is called after interactions typically, but redrawing might imply state change
    // updateHistory(); // Let interactions trigger history recording explicitly
  }

  // --- Drawing Specific Item Types ---

  // Find the existing drawText function in public/client.js
  // Replace the ENTIRE function with this enhanced version:

  function drawPinIndicator(item) {
    // Requires valid item position and dimensions
    if (
      typeof item.x !== 'number' || typeof item.y !== 'number' ||
      typeof item.width !== 'number' || typeof item.height !== 'number' ||
      item.width <= 0 || item.height <= 0
    ) {
      return; // Cannot draw indicator without valid geometry
    }

    const drawX = item.x;
    const drawY = item.y;
    // Scale the pin size and offset based on zoom, ensuring minimum visible size
    const basePinSize = 20; // Base size in screen pixels
    const minPinSize = 10; // Minimum screen pixels
    const pinSize = Math.max(minPinSize, basePinSize / Math.sqrt(zoom)); // Scale inversely with sqrt(zoom) for less drastic change
    const pinOffsetX = 5 / zoom; // Offset from corner in world coords
    const pinOffsetY = 5 / zoom;

    // Position at top-right corner
    const indicatorX = drawX + item.width - pinOffsetX - (pinSize / zoom); // Adjust X based on world size of pin
    const indicatorY = drawY + pinOffsetY;

    // Draw the pin emoji
    ctx.font = `${pinSize}px Arial`; // Font size in screen pixels
    ctx.textAlign = 'right'; // Align based on position
    ctx.textBaseline = 'top';
    // Add a slight shadow/background for visibility? Optional.
    // ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    // ctx.fillRect(indicatorX - (2 / zoom), indicatorY - (2 / zoom), (pinSize / zoom) + (4 / zoom), (pinSize / zoom) + (4 / zoom)); // Small background pad

    ctx.fillStyle = '#000000'; // Text color for emoji
    ctx.fillText('📌', indicatorX + (pinSize / zoom), indicatorY); // Draw emoji
  }

  socket.on("items-state", (serverItems) => {
    console.log(`Received updated items state (${serverItems.length} items) from server.`);
    items = serverItems || []; // Replace local items completely
    selectedItem = null; // Clear selection
    draggedItem = null;
    highlightedItemIDs.clear(); // Clear highlights
    // Don't clear image cache unless necessary
    preloadImages(items); // Preload images for the new state
    redrawCanvas();
    redrawMinimap();
    // Reset history? Or keep it? Let's keep history for now.
    // historyBackStack = [];
    // historyForwardStack = [];
    // updateHistoryButtons();
  });

  function drawText(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;
    const cardMaxWidth = 250; // Max width of the text card in world units
    const padding = 12; // Padding inside the card
    const fontSize = 16; // Base font size in world units
    const lineHeight = fontSize * 1.25; // Increased line height for readability
    const maxLinesToDisplay = 10; // Max lines to show
    const cornerRadius = 8; // For rounded corners

    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // 1. Calculate all wrapped lines based on original content
    const allCalculatedLines = [];
    const words = String(item.content || "").split(" ");
    let currentLine = "";
    let lineCount = 0; // Keep track of lines generated

    for (const word of words) {
      const testLine = currentLine ? currentLine + " " + word : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > cardMaxWidth - 2 * padding && currentLine) {
        // Word doesn't fit, push the current line
        allCalculatedLines.push(currentLine);
        lineCount++;
        currentLine = word; // Start new line with the current word
      } else {
        // Word fits, add it to the current line
        currentLine = testLine;
      }
    }
    // Push the last remaining line
    if (currentLine) {
      allCalculatedLines.push(currentLine);
      lineCount++;
    }

    // 2. Determine lines to display and if truncation occurred
    let displayLines = [];
    let truncated = false;
    if (allCalculatedLines.length > maxLinesToDisplay) {
      displayLines = allCalculatedLines.slice(0, maxLinesToDisplay);
      truncated = true;
      // Add ellipsis to the last displayed line
      const lastLine = displayLines[maxLinesToDisplay - 1];
      // Basic ellipsis addition - might need refinement based on space
      displayLines[maxLinesToDisplay - 1] =
        lastLine.length > 3 ? lastLine.slice(0, -3) + "..." : "...";
    } else {
      displayLines = allCalculatedLines;
    }
    // Handle case where content is empty resulting in zero lines
    if (displayLines.length === 0 && !item.content) {
      displayLines.push("<empty>"); // Show placeholder for empty items
    }

    // 3. Calculate card dimensions based on *displayed* lines
    const textHeight = displayLines.length * lineHeight;
    const cardWidth = cardMaxWidth; // Use fixed width for consistency
    const cardHeight = Math.max(fontSize * 1.5, textHeight) + 2 * padding; // Ensure a minimum height

    // Store dimensions on the item object for hit detection
    item.width = cardWidth;
    item.height = cardHeight;

    // 4. Draw the styled card (background, border, shadow)
    ctx.save(); // Save context state before applying shadow/styles

    // --- Card Style ---
    ctx.fillStyle = "#fffefb"; // Warm white background
    ctx.strokeStyle = "#dcdcdc"; // Soft gray border
    ctx.lineWidth = 1 / zoom; // Thin border relative to zoom
    ctx.shadowColor = "rgba(0, 0, 0, 0.1)"; // Subtle shadow
    ctx.shadowBlur = 5 / zoom; // Blur relative to zoom
    ctx.shadowOffsetX = 1 / zoom;
    ctx.shadowOffsetY = 2 / zoom;

    // Draw rounded rectangle path
    ctx.beginPath();
    ctx.moveTo(drawX + cornerRadius, drawY);
    ctx.lineTo(drawX + cardWidth - cornerRadius, drawY);
    ctx.arcTo(
      drawX + cardWidth,
      drawY,
      drawX + cardWidth,
      drawY + cornerRadius,
      cornerRadius
    );
    ctx.lineTo(drawX + cardWidth, drawY + cardHeight - cornerRadius);
    ctx.arcTo(
      drawX + cardWidth,
      drawY + cardHeight,
      drawX + cardWidth - cornerRadius,
      drawY + cardHeight,
      cornerRadius
    );
    ctx.lineTo(drawX + cornerRadius, drawY + cardHeight);
    ctx.arcTo(
      drawX,
      drawY + cardHeight,
      drawX,
      drawY + cardHeight - cornerRadius,
      cornerRadius
    );
    ctx.lineTo(drawX, drawY + cornerRadius);
    ctx.arcTo(drawX, drawY, drawX + cornerRadius, drawY, cornerRadius);
    ctx.closePath();

    ctx.fill(); // Fill the path (applying shadow)
    ctx.shadowColor = "transparent"; // Turn off shadow for border
    ctx.stroke(); // Stroke the path

    ctx.restore(); // Restore context state (removes shadow settings etc.)

    // 5. Draw the displayed text lines
    ctx.fillStyle = "#333333"; // Dark text color
    displayLines.forEach((line, index) => {
      ctx.fillText(line, drawX + padding, drawY + padding + index * lineHeight);
    });
  }

  function drawImage(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;

    const drawActualImage = (img, item) => {
      // Determine dimensions
      let targetWidth = typeof item.width === "number" ? item.width : 0;
      let targetHeight = typeof item.height === "number" ? item.height : 0;

      // If dimensions are missing or invalid, calculate from image aspect ratio
      if (
        !targetWidth ||
        !targetHeight ||
        targetWidth <= 0 ||
        targetHeight <= 0
      ) {
        const aspectRatio =
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? img.naturalWidth / img.naturalHeight
            : 1;
        targetWidth = 150; // Default width in world units
        targetHeight = targetWidth / aspectRatio;
        // Store calculated dimensions
        item.width = targetWidth;
        item.height = targetHeight;
      }
      ctx.drawImage(img, drawX, drawY, targetWidth, targetHeight);
    };

    const cacheKey = item.content;
    if (typeof cacheKey !== "string" || !cacheKey) {
      drawErrorPlaceholder(item); // Handle invalid content URL
      return;
    }

    if (imageCache[cacheKey]) {
      const img = imageCache[cacheKey];
      if (img.complete && img.naturalWidth > 0) {
        drawActualImage(img, item);
      } else if (img.failed) {
        drawErrorPlaceholder(item);
      } else {
        // Still loading
        drawLoadingPlaceholder(item);
      }
    } else {
      // Start loading
      drawLoadingPlaceholder(item); // Show loading placeholder initially
      const img = new Image();
      imageCache[cacheKey] = img;
      img.onload = () => {
        // Ensure dimensions are calculated if missing after load
        if (typeof item.width !== "number" || typeof item.height !== "number") {
          const aspectRatio =
            img.naturalWidth > 0 && img.naturalHeight > 0
              ? img.naturalWidth / img.naturalHeight
              : 1;
          item.width = 150;
          item.height = item.width / aspectRatio;
        }
        img.failed = false; // Mark as loaded successfully
        redrawCanvas(); // Redraw needed now that image is loaded
      };
      img.onerror = () => {
        console.error(`Failed to load image: ${cacheKey}`);
        img.failed = true;
        // Ensure placeholder size is set if load fails
        if (typeof item.width !== "number") item.width = 100;
        if (typeof item.height !== "number") item.height = 100;
        redrawCanvas(); // Redraw to show error state
      };
      img.src = cacheKey;
    }
  }

  function drawFile(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;

    // --- Configuration ---
    const cardWidth = 160; // Width of the card
    const cardHeight = 85; // Height of the card
    const cornerRadius = 8; // Rounded corners
    const padding = 10; // Internal padding
    const iconAreaWidth = 40; // Space reserved for the icon on the left
    const baseFontSize = 11; // Base font size for filename (world units)
    const maxFilenameLines = 2; // Max lines for filename display

    // Store dimensions on item for hit detection etc.
    // IMPORTANT: Ensure width/height are set for interactions like clicking/dragging
    item.width = cardWidth;
    item.height = cardHeight;

    // --- Get Icon ---
    // Use the helper function, passing mimetype and originalName from the item
    const icon = getIconForFile(item.mimetype, item.originalName);

    // --- Draw Card Background & Border ---
    ctx.save(); // Save context state for shadow/styling

    // Card Style - inspired by drawText for consistency
    ctx.fillStyle = "#ffffff"; // White background
    ctx.strokeStyle = "#cccccc"; // Border color
    ctx.lineWidth = 1 / zoom; // Thin border adjusted for zoom
    ctx.shadowColor = "rgba(0, 0, 0, 0.1)"; // Subtle shadow
    ctx.shadowBlur = 5 / zoom; // Adjust blur based on zoom
    ctx.shadowOffsetX = 1 / zoom; // Adjust offset based on zoom
    ctx.shadowOffsetY = 2 / zoom; // Adjust offset based on zoom

    // Draw rounded rectangle path
    ctx.beginPath();
    ctx.moveTo(drawX + cornerRadius, drawY);
    ctx.lineTo(drawX + cardWidth - cornerRadius, drawY);
    ctx.arcTo(drawX + cardWidth, drawY, drawX + cardWidth, drawY + cornerRadius, cornerRadius);
    ctx.lineTo(drawX + cardWidth, drawY + cardHeight - cornerRadius);
    ctx.arcTo(drawX + cardWidth, drawY + cardHeight, drawX + cardWidth - cornerRadius, drawY + cardHeight, cornerRadius);
    ctx.lineTo(drawX + cornerRadius, drawY + cardHeight);
    ctx.arcTo(drawX, drawY + cardHeight, drawX, drawY + cardHeight - cornerRadius, cornerRadius);
    ctx.lineTo(drawX, drawY + cornerRadius);
    ctx.arcTo(drawX, drawY, drawX + cornerRadius, drawY, cornerRadius);
    ctx.closePath();

    ctx.fill(); // Apply background and shadow
    ctx.shadowColor = "transparent"; // Disable shadow before drawing border
    ctx.stroke(); // Draw the border

    ctx.restore(); // Restore context state (removes shadow settings)

    // --- Draw Icon ---
    const baseIconSize = 30; // Base size in world units
    // Scale icon font size - make it somewhat consistent on screen via sqrt(zoom)
    const iconFontSize = Math.max(16 / zoom, baseIconSize); // Make icon scale less drastically than world
    //const iconFontSize = Math.max(16, baseIconSize / Math.sqrt(zoom)); // Alternative scaling
    ctx.font = `${iconFontSize}px Arial`; // Use scaled font size for emoji
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#333333"; // Icon color
    // Position icon centered vertically, and horizontally within the dedicated icon area
    ctx.fillText(icon, drawX + padding + iconAreaWidth / 2, drawY + cardHeight / 2);

    // --- Draw Filename ---
    const filename = item.originalName || "file"; // Fallback name
    const textX = drawX + iconAreaWidth + padding * 1.5; // Start text after icon area + padding
    const textMaxWidth = cardWidth - iconAreaWidth - padding * 2; // Available width for text
    // Scale filename font size inversely with sqrt(zoom) for readability
    const fontSize = Math.max(8, baseFontSize / Math.sqrt(zoom));
    const lineHeight = fontSize * 1.25; // Line height

    ctx.font = `${fontSize}px Arial`;
    ctx.fillStyle = "#333333"; // Text color
    ctx.textAlign = "left";
    ctx.textBaseline = "top"; // Align to top for wrapping logic

    // Simplified text splitting/truncating logic
    let linesToDraw = [];
    let remainingText = filename;
    const avgCharWidth = fontSize * 0.6; // Rough estimate for average char width
    const maxCharsPerLine = Math.max(5, Math.floor(textMaxWidth / avgCharWidth));

    for (let i = 0; i < maxFilenameLines; i++) {
      if (!remainingText) break;

      let line;
      let splitIndex = Math.min(remainingText.length, maxCharsPerLine);
      let lastSpaceIndex = remainingText.substring(0, splitIndex).lastIndexOf(' ');

      // If it's the last allowed line and there's more text than fits
      if (i === maxFilenameLines - 1 && remainingText.length > maxCharsPerLine) {
        // Try to break at last space if sensible, otherwise force break
        if (lastSpaceIndex > 0 && remainingText.substring(0, lastSpaceIndex).trim().length > 0) {
          line = remainingText.substring(0, lastSpaceIndex).trim() + '…';
        } else { // Force break at char limit - 1
          line = remainingText.substring(0, maxCharsPerLine - 1) + '…';
        }
        linesToDraw.push(line);
        break; // Finished
      }
      // Not the last line, or it fits on the last line
      else {
        // If the whole remaining text fits within the max width based on actual measurement
        if (ctx.measureText(remainingText).width <= textMaxWidth) {
          line = remainingText;
          remainingText = ''; // No more text left
        }
        // Try word break based on space
        else if (lastSpaceIndex > 0 && remainingText.substring(0, lastSpaceIndex).trim().length > 0) {
          line = remainingText.substring(0, lastSpaceIndex).trim();
          remainingText = remainingText.substring(lastSpaceIndex + 1); // Skip space for next line
        }
        // Force break at char limit if no suitable space found or word is too long
        else {
          line = remainingText.substring(0, maxCharsPerLine);
          remainingText = remainingText.substring(maxCharsPerLine);
        }
        linesToDraw.push(line);
      }
    }

    // Calculate starting Y to center the text block vertically
    const totalTextHeight = linesToDraw.length * lineHeight;
    const startYText = drawY + (cardHeight - totalTextHeight) / 2;

    // Draw the calculated lines
    linesToDraw.forEach((line, index) => {
      ctx.fillText(line, textX, startYText + index * lineHeight);
    });

    // --- Draw Item Extras (Nickname, Tags) ---
    // Call the existing function to draw owner/tags below the card
    // Ensure drawItemExtras uses item.height correctly.
    drawItemExtras(item);
  }


  function drawLoadingPlaceholder(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;
    // Use stored/default size for placeholder
    const width = typeof item.width === "number" ? item.width : 100;
    const height = typeof item.height === "number" ? item.height : 100;
    item.width = width; // Ensure size is stored
    item.height = height;

    ctx.fillStyle = "#f9f9f9";
    ctx.fillRect(drawX, drawY, width, height);
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(drawX, drawY, width, height);

    ctx.fillStyle = "#a0a0a0";
    const fontSize = Math.max(8, 12 / Math.sqrt(zoom));
    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Loading...", drawX + width / 2, drawY + height / 2);
  }

  function drawErrorPlaceholder(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;
    // Use stored/default size for placeholder
    const width = typeof item.width === "number" ? item.width : 100;
    const height = typeof item.height === "number" ? item.height : 100;
    item.width = width; // Ensure size is stored
    item.height = height;

    ctx.fillStyle = "#ffe0e0"; // Light red background
    ctx.fillRect(drawX, drawY, width, height);
    ctx.strokeStyle = "#ffb0b0"; // Red border
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(drawX, drawY, width, height);

    ctx.fillStyle = "#cc0000"; // Dark red text
    const fontSize = Math.max(8, 12 / Math.sqrt(zoom));
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Error", drawX + width / 2, drawY + height / 2);
  }

  // --- Draw Extras (Nickname, Tags) ---
  function drawItemExtras(item) {
    // Requires valid item position and dimensions
    if (
      typeof item.x !== "number" ||
      typeof item.y !== "number" ||
      typeof item.width !== "number" ||
      typeof item.height !== "number" ||
      item.width <= 0 ||
      item.height <= 0
    ) {
      return; // Cannot draw extras without valid geometry
    }

    const drawX = item.x;
    const drawY = item.y;
    const itemBottom = drawY + item.height;
    const baseFontSize = Math.max(6, 9 / Math.sqrt(zoom)); // Scale font size
    let currentYOffset = 5 / zoom; // Start drawing below the item, scaled offset

    ctx.font = `${baseFontSize}px Arial`;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#555"; // Dark gray for extra info

    // Draw Owner Nickname
    if (item.ownerUserID && userMap[item.ownerUserID]) {
      const ownerText = `By: ${userMap[item.ownerUserID]}`;
      ctx.fillText(ownerText, drawX, itemBottom + currentYOffset);
      currentYOffset += baseFontSize * 1.2; // Move down for next line
    }

    // Draw Tags
    if (item.tags && item.tags.length > 0) {
      const tagsText = `Tags: ${item.tags.join(", ")}`;
      const maxTextWidth = item.width * 1.5; // Allow text to flow slightly wider than item

      // Simple truncation if text exceeds max width
      const metrics = ctx.measureText(tagsText);
      if (metrics.width > maxTextWidth) {
        let charsThatFit = Math.floor(
          tagsText.length * (maxTextWidth / metrics.width)
        );
        // Ensure we don't cut off too much or go negative
        charsThatFit = Math.max(0, charsThatFit - 3);
        ctx.fillText(
          tagsText.substring(0, charsThatFit) + "...",
          drawX,
          itemBottom + currentYOffset
        );
      } else {
        ctx.fillText(tagsText, drawX, itemBottom + currentYOffset);
      }
      // currentYOffset += baseFontSize * 1.2; // Increment offset if more extras are added below
    }
  }

  // --- Draw Grid ---
  // --- Draw Grid ---
  function drawGrid(cssWidth, cssHeight) {
    ctx.save(); // Save context state before drawing grid

    const worldTopLeft = screenToWorld(0, 0);
    const worldBottomRight = screenToWorld(cssWidth, cssHeight);

    // Define a buffer around the viewport in world units (e.g., 10 grid cells)
    // This pre-draws lines that are about to come into view when panning.
    const buffer = GRID_SIZE * 10;

    // Calculate the bounds of the expanded area (viewport + buffer)
    const expandedTopLeftX = worldTopLeft.x - buffer;
    const expandedTopLeftY = worldTopLeft.y - buffer;
    const expandedBottomRightX = worldBottomRight.x + buffer;
    const expandedBottomRightY = worldBottomRight.y + buffer;

    ctx.strokeStyle = "rgba(0, 0, 0, 0.08)"; // Lighter grid lines
    ctx.lineWidth = 1 / zoom; // Make lines appear 1px wide regardless of zoom

    // Calculate grid start/end points aligned to GRID_SIZE based on the EXPANDED view
    const startX = Math.floor(expandedTopLeftX / GRID_SIZE) * GRID_SIZE;
    const endX = Math.ceil(expandedBottomRightX / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor(expandedTopLeftY / GRID_SIZE) * GRID_SIZE;
    const endY = Math.ceil(expandedBottomRightY / GRID_SIZE) * GRID_SIZE;

    // Performance safeguard: Limit the number of lines drawn in each direction
    const maxLines = 200; // Adjust if necessary
    let verticalLinesDrawn = 0;
    let horizontalLinesDrawn = 0;

    // Begin path for all grid lines (potential minor optimization)
    ctx.beginPath();

    // Draw vertical lines within the expanded range
    for (let x = startX; x <= endX && verticalLinesDrawn < maxLines; x += GRID_SIZE) {
      ctx.moveTo(x, startY); // Line starts at the top of the expanded range
      ctx.lineTo(x, endY);   // Line ends at the bottom of the expanded range
      verticalLinesDrawn++;
    }

    // Draw horizontal lines within the expanded range
    for (let y = startY; y <= endY && horizontalLinesDrawn < maxLines; y += GRID_SIZE) {
      ctx.moveTo(startX, y); // Line starts at the left of the expanded range
      ctx.lineTo(endX, y);   // Line ends at the right of the expanded range
      horizontalLinesDrawn++;
    }

    // Stroke all the lines added to the path at once
    ctx.stroke();

    ctx.restore(); // Restore context state
  }

  // --- Draw Presence Indicators ---
  function drawPresence() {
    const now = Date.now();
    const PRESENCE_TIMEOUT = 30000; // 30 seconds

    Object.keys(otherUsersPresence).forEach((userID) => {
      if (userID === myUserID) return; // Don't draw self

      const presence = otherUsersPresence[userID];
      // Check timestamp and if data exists
      if (
        !presence ||
        !presence.data ||
        now - (presence.timestamp || 0) > PRESENCE_TIMEOUT
      ) {
        return; // Skip stale or invalid presence
      }

      const nickname = userMap[userID] || "User"; // Get nickname

      // Example: Draw viewport rectangle or marker based on presence data type
      if (presence.data.type === "view" && presence.data.view) {
        const view = presence.data.view; // { x: worldCenterX, y: worldCenterY, zoom: userZoom }

        // Check if view data is valid
        if (typeof view.x !== "number" || typeof view.y !== "number") return;

        // Draw a marker at the user's view center (in world coordinates)
        ctx.fillStyle = "rgba(255, 0, 0, 0.5)"; // Red marker for others' centers
        const markerSize = 10 / zoom; // Size in world units, appears constant size on screen
        ctx.fillRect(
          view.x - markerSize / 2,
          view.y - markerSize / 2,
          markerSize,
          markerSize
        );

        // Draw nickname below the marker
        ctx.fillStyle = "#cc0000"; // Dark red text
        ctx.font = `${Math.max(8, 12 / Math.sqrt(zoom))}px Arial`; // Scale font size
        ctx.textAlign = "center";
        ctx.textBaseline = "top"; // Align text top to position below marker
        ctx.fillText(nickname, view.x, view.y + markerSize * 0.7); // Adjust Y offset for label
      }
      // Add logic here for drawing cursor positions if presence.data.type === 'cursor'
    });
  }

  // --- Minimap Drawing ---
  function redrawMinimap() {
    if (!myUserID) return; // Don't draw if not initialized

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = minimapCanvas.clientWidth; // Use clientWidth for logical size
    const cssHeight = minimapCanvas.clientHeight;

    minimapCtx.save();
    // The initial scale(dpr, dpr) handles resolution

    // Clear minimap
    minimapCtx.fillStyle = "rgba(230, 230, 230, 0.9)"; // Slightly different background
    minimapCtx.fillRect(0, 0, cssWidth, cssHeight);

    // Determine overall bounds of items in the world
    const worldBounds = calculateWorldBounds(items, 200); // Use actual items + padding

    // Calculate mapping from world coords to minimap coords (maintaining aspect ratio)
    const scaleX = cssWidth / worldBounds.width;
    const scaleY = cssHeight / worldBounds.height;
    const minimapScale = Math.min(scaleX, scaleY) * 0.95; // Add small margin (0.95)

    if (minimapScale <= 0 || !isFinite(minimapScale)) {
      minimapCtx.restore(); // Prevent errors if scale is invalid
      return;
    }

    // Center the world content within the minimap
    const offsetX_mm =
      (cssWidth - worldBounds.width * minimapScale) / 2 -
      worldBounds.minX * minimapScale;
    const offsetY_mm =
      (cssHeight - worldBounds.height * minimapScale) / 2 -
      worldBounds.minY * minimapScale;

    minimapCtx.translate(offsetX_mm, offsetY_mm);
    minimapCtx.scale(minimapScale, minimapScale);

    // Draw simplified items (dots or small rects)
    minimapCtx.fillStyle = "rgba(0, 0, 0, 0.3)"; // Dark dots for items
    items.forEach((item) => {
      // Ensure item has valid position
      if (typeof item.x !== "number" || typeof item.y !== "number") return;
      // Ensure item has some minimal size for drawing
      const itemWidth =
        typeof item.width === "number" && item.width > 0 ? item.width : 1;
      const itemHeight =
        typeof item.height === "number" && item.height > 0 ? item.height : 1;
      // Draw item as a small rect in world scale
      minimapCtx.fillRect(item.x, item.y, itemWidth, itemHeight);
    });

    // Draw current viewport rectangle (map main canvas view to world, then to minimap)
    const viewTopLeft_world = screenToWorld(0, 0);
    const viewBottomRight_world = screenToWorld(
      canvas.clientWidth,
      canvas.clientHeight
    );
    const viewWidth_world = viewBottomRight_world.x - viewTopLeft_world.x;
    const viewHeight_world = viewBottomRight_world.y - viewTopLeft_world.y;

    if (viewWidth_world > 0 && viewHeight_world > 0) {
      minimapCtx.strokeStyle = "rgba(0, 100, 255, 0.8)"; // Blue viewport outline
      minimapCtx.lineWidth = 2 / minimapScale; // Make line thicker relative to minimap scale
      minimapCtx.strokeRect(
        viewTopLeft_world.x,
        viewTopLeft_world.y,
        viewWidth_world,
        viewHeight_world
      );
    }

    minimapCtx.restore();
  }

  // Helper to calculate world bounds
  function calculateWorldBounds(items, padding = 100) {
    if (items.length === 0) {
      // Provide a default view area if canvas is empty
      return { minX: -500, minY: -500, width: 1000, height: 1000 };
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let hasValidItem = false;
    items.forEach((item) => {
      // Only consider items with valid position and dimensions
      if (typeof item.x === "number" && typeof item.y === "number") {
        const itemWidth = typeof item.width === "number" ? item.width : 1;
        const itemHeight = typeof item.height === "number" ? item.height : 1;
        minX = Math.min(minX, item.x);
        minY = Math.min(minY, item.y);
        maxX = Math.max(maxX, item.x + itemWidth);
        maxY = Math.max(maxY, item.y + itemHeight);
        hasValidItem = true;
      }
    });

    // If no valid items found, return default bounds
    if (!hasValidItem) {
      return { minX: -500, minY: -500, width: 1000, height: 1000 };
    }

    // Calculate dimensions and add padding
    const width = maxX - minX || 1; // Ensure non-zero width/height
    const height = maxY - minY || 1;

    return {
      minX: minX - padding,
      minY: minY - padding,
      width: width + 2 * padding,
      height: height + 2 * padding,
    };
  }

  // --- Socket Event Handlers ---
  socket.on("connect", () => {
    console.log("Connected to server:", socket.id);
    isAttemptingReconnect = false; // Successfully connected/reconnected
    hideReconnectingIndicator(); // Hide indicator on successful connection/reconnection

    // Check if this is a RECONNECT event after a prior connection
    if (myUserID && myNickname) {
      console.log(
        `Reconnected as ${myNickname} (${myUserID}). Re-identifying...`
      );
      // Send existing credentials to the server to re-associate the new socket.id
      socket.emit("re-identify", {
        storedUserID: myUserID,
        storedNickname: myNickname,
      });
      // The server should respond (e.g., with 'init' or 'reconnect-success')
      // to confirm and provide potentially updated state.
    } else {
      console.log("Initial connection or state lost. Waiting for nickname.");
      // This is the first connection, or state was lost (e.g., browser refresh)
      // Ensure nickname dialog is visible if needed (it should be by default)
      nicknameDialog.classList.remove("hidden");
      nicknameInput.focus();
    }
  });

  socket.on("disconnect", (reason) => {
    console.warn("Disconnected from server:", reason);
    if (reason === "io server disconnect") {
      // The server deliberately disconnected the socket. Reconnection likely won't work.
      console.error(
        "Server disconnected socket. Manual intervention likely required."
      );
      showReconnectingIndicator("Server connection closed. Please refresh.");
      // Optionally, force reset and show nickname dialog here
      resetClientState(); // You would need to create this function
      // nicknameDialog.classList.remove("hidden");
    } else {
      // Other reasons (transport close, transport error, ping timeout)
      // Socket.IO will attempt to reconnect automatically.
      // Show a visual indicator.
      showReconnectingIndicator(
        `Connection lost: ${reason}. Attempting to reconnect...`
      );
      isAttemptingReconnect = true;
    }
    updateUserCount("?"); // Indicate uncertain user count
    // Maybe disable UI elements here?
    document.body.classList.add("disconnected");
  });

  socket.io.on("reconnect_attempt", (attemptNumber) => {
    console.log(`Reconnection attempt ${attemptNumber}...`);
    isAttemptingReconnect = true;
    showReconnectingIndicator(
      `Connection lost. Reconnecting (attempt ${attemptNumber})...`
    );
    document.body.classList.add("disconnected"); // Ensure UI stays disabled
  });

  socket.io.on("reconnect", (attemptNumber) => {
    // This event fires just before the 'connect' event on successful reconnection.
    console.log(`Successfully reconnected after ${attemptNumber} attempts.`);
    // The 'connect' handler will take care of re-identifying and hiding the indicator.
    isAttemptingReconnect = false; // Mark as no longer attempting
    // UI will be re-enabled in 'init' or 'reconnect-success' handler
  });

  socket.io.on("reconnect_error", (error) => {
    console.error("Reconnection attempt failed:", error);
    isAttemptingReconnect = true; // Still trying if attempts remain
    showReconnectingIndicator(
      `Reconnection failed: ${error.message}. Retrying...`
    );
    document.body.classList.add("disconnected");
  });

  socket.io.on("reconnect_failed", () => {
    console.error("Failed to reconnect after maximum attempts.");
    isAttemptingReconnect = false;
    showReconnectingIndicator(
      "Could not reconnect to the server. Please refresh the page."
    );
    // Keep UI disabled? Or prompt user?
    document.body.classList.add("disconnected"); // Keep UI disabled
    // At this point, you might want to fully reset state and force nickname dialog
    resetClientState(); // You would need to create this function
    // nicknameDialog.classList.remove("hidden");
  });

  socket.on("connect_error", (err) => {
    console.error("Connection Error:", err);
    // This often happens during initial connection attempts
    // If already connected and this happens, it might trigger disconnect logic.
    if (!isAttemptingReconnect && !myUserID) {
      // Only show if initial connection fails
      nicknameError.textContent = `Connection failed: ${err.message}.`;
      nicknameError.classList.remove("hidden");
      nicknameDialog.classList.remove("hidden"); // Ensure dialog is visible
    } else if (isAttemptingReconnect) {
      // Error during a reconnection attempt, handled by reconnect_error
    } else {
      // Error occurred while seemingly connected, might lead to disconnect
      showReconnectingIndicator(
        `Connection error: ${err.message}. Attempting to reconnect...`
      );
      document.body.classList.add("disconnected");
    }
  });

  // Nickname Handling Callbacks
  socket.on("nickname-set", (data) => {
    console.log("Nickname accepted:", data);
    myUserID = data.userID;
    myNickname = data.nickname;
    nicknameDialog.classList.add("hidden"); // Hide modal
    nicknameError.classList.add("hidden");
    // Client is now authenticated, wait for 'init' event for state
    // Re-enable UI in case it was disabled during connection attempt
    document.body.classList.remove("disconnected");
    hideReconnectingIndicator();
  });

  socket.on("nickname-error", (errorMessage) => {
    nicknameError.textContent = errorMessage;
    nicknameError.classList.remove("hidden");
    // Keep nickname dialog open
    document.body.classList.remove("disconnected"); // Allow interaction with dialog
    hideReconnectingIndicator();
  });
  // Initial State & Updates
  // Initial State & Updates
  socket.on("init", (data) => {
    console.log("Received initial state from server.");
    // This now handles both initial load AND state sync after successful reconnect
    items = data.items || [];
    userMap = data.users || {};
    bookmarks = data.bookmarks || []; // Receive own bookmarks based on userID
    otherUsersPresence = data.presence || {}; // Receive current presence
    updateUserCount(Object.keys(userMap).length);
    updateBookmarksList();
    preloadImages(items);
    redrawCanvas();
    redrawMinimap();

    // Only zoom-to-fit on FIRST successful init, not necessarily on reconnect sync
    if (historyBackStack.length === 0 && historyForwardStack.length === 0) {
      zoomToFitAll(true); // Zoom to fit initial items immediately
    }

    historyBackStack = []; // Clear history on init/reconnect state sync
    historyForwardStack = [];
    updateHistoryButtons();

    // Ensure UI is enabled and indicator is hidden
    hideReconnectingIndicator();
    document.body.classList.remove("disconnected");

    console.log(
      `Initialization/Sync complete. User: ${myNickname} (${myUserID})`
    );
  });

  socket.on("user-updated", (userData) => {
    if (!userData || !userData.userID) return;
    console.log(`User updated: ${userData.nickname} (${userData.userID})`);
    userMap[userData.userID] = userData.nickname;
    updateUserCount(Object.keys(userMap).length);
    redrawCanvas(); // Redraw needed if nickname display changes on items/presence
  });

  socket.on("user-left", (data) => {
    if (!data || !data.userID) return;
    console.log(
      `User left: ${userMap[data.userID] || "Unknown"} (${data.userID})`
    );
    delete userMap[data.userID];
    delete otherUsersPresence[data.userID]; // Remove presence data
    updateUserCount(Object.keys(userMap).length);
    redrawCanvas(); // Redraw needed to remove presence indicators etc.
  });

  socket.on("item-added", (item) => {
    if (!item || !item.id) return; // Ignore invalid data
    // Check if item already exists (e.g., self-added confirmation)
    const existingIndex = items.findIndex(
      (existing) => existing.id === item.id
    );
    if (existingIndex === -1) {
      console.log(`Item added: ${item.id} (${item.type})`);
      items.push(item);
      if (item.type === "image") preloadImages([item]); // Preload if it's an image
      // Redraw needed, minimap update depends on bounds change
      redrawCanvas();
      redrawMinimap(); // Update minimap as item bounds might change
    } else {
      // Item already exists, potentially update it if server sends full data
      console.log(`Received update for existing item via add: ${item.id}`);
      Object.assign(items[existingIndex], item);
      if (item.type === "image") preloadImages([item]);
      redrawCanvas();
      redrawMinimap();
    }
  });

  function showReconnectingIndicator(message = "Attempting to reconnect...") {
    if (!reconnectingIndicator) return;
    reconnectingIndicator.querySelector("p").textContent = message;
    reconnectingIndicator.classList.remove("hidden");
  }

  function hideReconnectingIndicator() {
    if (!reconnectingIndicator) return;
    reconnectingIndicator.classList.add("hidden");
  }

  function updateUserCount(count) {
    // Keep this function
    userCountSpan.textContent = `Devices: ${count}`;
  }

  socket.on("item-updated", (updatedData) => {
    if (!updatedData || !updatedData.id) return; // Ignore invalid data

    const index = items.findIndex((item) => item.id === updatedData.id);
    if (index !== -1) {
      const isCurrentlySelected =
        selectedItem && selectedItem.id === updatedData.id;

      // Merge changes - crucial for partial updates (position, tags, etc.)
      Object.assign(items[index], updatedData);

      if (updatedData.hasOwnProperty('isPinned')) {
        console.log(`Item ${updatedData.id} pin status received: ${updatedData.isPinned}`);
        // If this item was selected, update the context menu state if it's open
        // (although it usually closes on action, this is a safety measure)
        if (isCurrentlySelected && !contextMenu.classList.contains('hidden')) {
          const isPinned = items[index].isPinned === true;
          pinBtn.textContent = isPinned ? "📌 Unpin Item" : "📌 Pin Item";
          deleteBtn.disabled = isPinned;
          deleteBtn.style.opacity = isPinned ? 0.5 : 1;
          deleteBtn.style.cursor = isPinned ? 'not-allowed' : 'pointer';
          deleteBtn.title = isPinned ? "Cannot delete a pinned item" : "Delete this item";
        }
      } s

      // If the update included image content, ensure it's preloaded
      if (items[index].type === "image" && updatedData.content) {
        preloadImages([items[index]]);
      }

      // If the updated item was selected, ensure selection points to the updated object reference
      if (isCurrentlySelected) {
        selectedItem = items[index];
      }

      console.log(`Item updated: ${updatedData.id}`, updatedData);
      redrawCanvas();
      // Redraw minimap only if position/size changed significantly? Optimization.
      // For simplicity, redraw if position changed.
      if (
        updatedData.x !== undefined ||
        updatedData.y !== undefined ||
        updatedData.width !== undefined ||
        updatedData.height !== undefined
      ) {
        redrawMinimap();
      }
    } else {
      console.warn(`Received update for non-existent item: ${updatedData.id}`);
    }
  });

  socket.on("item-deleted", (id) => {
    if (!id) return;
    const index = items.findIndex((item) => item.id === id);
    if (index !== -1) {
      console.log(`Item deleted: ${id}`);
      items.splice(index, 1);
      // Clear selection if deleted item was selected
      if (selectedItem && selectedItem.id === id) selectedItem = null;
      highlightedItemIDs.delete(id); // Remove from highlights if deleted
      redrawCanvas();
      redrawMinimap(); // Bounds changed
    }
  });

  socket.on("canvas-cleared", () => {
    console.log("Received canvas-cleared signal. Waiting for items-state...");
    // --- Do NOT clear items locally here anymore ---
    // items = [];
    // selectedItem = null;
    // draggedItem = null;
    // highlightedItemIDs.clear();
    // Object.keys(imageCache).forEach((key) => delete imageCache[key]);
    // redrawCanvas();
    // redrawMinimap();
    // historyBackStack = [];
    // historyForwardStack = [];
    // updateHistoryButtons();
    // --- Instead, wait for the 'items-state' event ---
    // Optionally show a temporary "Clearing..." message
  });

  function resetClientState() {
    console.warn("Resetting client state completely.");

    // 1. Reset Core State Variables
    myUserID = null;
    myNickname = null;
    userMap = {};
    items = []; // Clear local items
    otherUsersPresence = {};
    bookmarks = [];
    selectedItem = null;
    draggedItem = null;
    highlightedItemIDs.clear();
    historyBackStack = [];
    historyForwardStack = [];
    Object.keys(imageCache).forEach((key) => delete imageCache[key]); // Clear image cache
    isAttemptingReconnect = false; // Ensure reconnect flag is off
    isDragging = false;
    isPanning = false;
    isPinching = false;
    // Reset any other relevant state flags if needed

    // 2. Clear Canvases
    const dpr = window.devicePixelRatio || 1;
    if (ctx) {
      // Check if context exists
      // Use the logical CSS size for clearing
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      // Reset transform before clearing might be safer
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Reset to DPR scale only
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      ctx.restore();
    }
    if (minimapCtx) {
      // Check if context exists
      const miniCssWidth = minimapCanvas.clientWidth;
      const miniCssHeight = minimapCanvas.clientHeight;
      minimapCtx.save();
      minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      minimapCtx.clearRect(0, 0, miniCssWidth, miniCssHeight);
      minimapCtx.restore();
    }

    // 3. Update UI Elements
    updateUserCount("?");
    updateBookmarksList(); // Clears the dropdown
    updateHistoryButtons(); // Disables history buttons
    hideContextMenu(); // Ensure context menu is hidden
    // Ensure other dialogs are hidden (paste, tag editor)
    pasteDialog.classList.add("hidden");
    tagEditorDialog.classList.add("hidden");
    currentItemForTagEditing = null;
    // Hide progress container if it exists and isn't already hidden
    const uploadProgressContainer = document.getElementById(
      "upload-progress-container"
    );
    if (
      uploadProgressContainer &&
      !uploadProgressContainer.classList.contains("hidden")
    ) {
      uploadProgressContainer.innerHTML = ""; // Clear any stale progress items
      uploadProgressContainer.classList.add("hidden");
    }
    loadingIndicator.classList.add("hidden"); // Hide generic loading indicator

    // 4. Show Nickname Dialog
    nicknameInput.value = ""; // Clear previous nickname attempt
    nicknameError.textContent =
      "Session ended or failed to connect. Please enter nickname to join."; // Set appropriate message
    nicknameError.classList.remove("hidden");
    nicknameDialog.classList.remove("hidden");
    nicknameInput.focus();

    // 5. Hide Reconnecting Indicator & Re-enable Body Interactions
    hideReconnectingIndicator();
    document.body.classList.remove("disconnected"); // Allow interaction with nickname dialog
  }

  socket.on("user-count", (count) => updateUserCount(count));

  // Search/Filter Results
  socket.on("filter-results", (results) => {
    if (!results || !Array.isArray(results.matchingIDs)) return;
    console.log(`Received ${results.matchingIDs.length} filter results`);
    highlightedItemIDs = new Set(results.matchingIDs);
    redrawCanvas(); // Redraw to show highlights
    // Optionally trigger zoom-to-results here or via a button
    // zoomToItems(highlightedItemIDs);
  });

  // Bookmarks Update
  socket.on("bookmarks-updated", (updatedBookmarks) => {
    bookmarks = updatedBookmarks || [];
    updateBookmarksList();
  });

  // Presence Update
  socket.on("presence-update", (data) => {
    // Ignore self or invalid data
    if (
      !data ||
      !data.userID ||
      !myUserID ||
      data.userID === myUserID ||
      !data.presenceData
    )
      return;

    otherUsersPresence[data.userID] = {
      data: data.presenceData,
      timestamp: Date.now(), // Store arrival time
    };
    redrawCanvas(); // Need redraw to show presence indicators
  });

  // --- Helper Functions ---
  function updateUserCount(count) {
    userCountSpan.textContent = `Devices: ${count}`;
  }

  if (toolbar && toolbarToggleBtn && toggleIcon) {
    // <<< UPDATED check (no container)
    const TOOLBAR_COLLAPSED_KEY = "toolbarCollapsed";

    // Function to set state
    const setToolbarState = (collapsed) => {
      if (collapsed) {
        toolbar.classList.add("collapsed"); // Collapse the toolbar itself
        toolbarToggleBtn.classList.add("collapsed"); // Add class to button for icon styling
        // toggleIcon.textContent = '🔼'; // Or set specific icon for "show"
        toolbarToggleBtn.title = "Show Toolbar";
      } else {
        toolbar.classList.remove("collapsed"); // Expand the toolbar
        toolbarToggleBtn.classList.remove("collapsed"); // Remove class from button
        // toggleIcon.textContent = '🔼'; // Or set specific icon for "hide"
        toolbarToggleBtn.title = "Hide Toolbar";
      }
      // Save state to localStorage
      try {
        localStorage.setItem(TOOLBAR_COLLAPSED_KEY, collapsed);
      } catch (e) {
        console.warn(
          "LocalStorage not available or error saving toolbar state:",
          e
        );
      }
    };

    // Add click listener to the toggle button
    toolbarToggleBtn.addEventListener("click", () => {
      // Check the button's class for current state
      const isCurrentlyCollapsed =
        toolbarToggleBtn.classList.contains("collapsed"); // <<< UPDATED Check button's class
      setToolbarState(!isCurrentlyCollapsed); // Toggle the state
    });

    // Initialize state from localStorage on load
    let initialStateCollapsed = false;
    try {
      initialStateCollapsed =
        localStorage.getItem(TOOLBAR_COLLAPSED_KEY) === "true";
    } catch (e) {
      console.warn(
        "LocalStorage not available or error reading toolbar state:",
        e
      );
    }
    setToolbarState(initialStateCollapsed); // Apply initial state
  } else {
    console.error("Toolbar elements not found (toolbar or toggle button)!"); // <<< UPDATED Error message
  }

  function preloadImages(itemList) {
    // Preloads images for items of type 'image'
    itemList.forEach((item) => {
      if (
        item &&
        item.type === "image" &&
        item.content &&
        typeof item.content === "string" && // Check if content is a valid string URL/dataURL
        !imageCache[item.content] // Check if not already cached/loading
      ) {
        const cacheKey = item.content;
        const img = new Image();
        imageCache[cacheKey] = img; // Add to cache immediately to prevent re-attempts
        img.onload = () => {
          console.log(`Image loaded: ${cacheKey.substring(0, 50)}...`);
          img.failed = false;
          // Ensure dimensions are calculated after load if missing
          if (
            typeof item.width !== "number" ||
            typeof item.height !== "number" ||
            item.width <= 0 ||
            item.height <= 0
          ) {
            const aspectRatio =
              img.naturalWidth > 0 && img.naturalHeight > 0
                ? img.naturalWidth / img.naturalHeight
                : 1;
            item.width = 150; // Default width
            item.height = item.width / aspectRatio;
          }
          redrawCanvas(); // Redraw needed to display the loaded image
        };
        img.onerror = () => {
          console.error(`Failed to load image: ${cacheKey}`);
          img.failed = true;
          // Ensure placeholder dimensions if load fails
          if (typeof item.width !== "number") item.width = 100;
          if (typeof item.height !== "number") item.height = 100;
          redrawCanvas(); // Redraw to show error state
        };
        img.src = cacheKey; // Start loading
      }
    });
  }

  function getMousePos(canvasElement, event) {
    // Returns mouse position in WORLD coordinates
    const rect = canvasElement.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    return screenToWorld(screenX, screenY);
  }

  function getTouchPos(canvasElement, event) {
    // Returns touch position (first touch) in WORLD coordinates
    const rect = canvasElement.getBoundingClientRect();
    // Use the first touch point from the relevant list (touches or changedTouches)
    const touch = event.touches[0] || event.changedTouches[0];
    if (!touch) return null; // No touch point found
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;
    return screenToWorld(screenX, screenY);
  }

  // **REVISED isPointInItem**
  function isPointInItem(worldX, worldY, item) {
    // Check if a world point is inside an item's bounds
    if (!item || typeof item.x !== "number" || typeof item.y !== "number") {
      return false; // Invalid item position
    }
    // Use item dimensions, providing a minimum clickable area if dimensions are missing/invalid
    const width =
      typeof item.width === "number" && item.width > 0 ? item.width : 1; // Min 1px width
    const height =
      typeof item.height === "number" && item.height > 0 ? item.height : 1; // Min 1px height

    return (
      worldX >= item.x &&
      worldX <= item.x + width &&
      worldY >= item.y &&
      worldY <= item.y + height
    );
  }

  function getItemAtPos(worldX, worldY) {
    // Finds the topmost item at the given world coordinates
    // Iterate backwards to check topmost items first
    for (let i = items.length - 1; i >= 0; i--) {
      if (isPointInItem(worldX, worldY, items[i])) {
        return items[i];
      }
    }
    return null; // No item found
  }

  function showContextMenu(clientX, clientY, item) {
    hideContextMenu(); // Hide any existing menu
    selectedItem = item; // Set the selected item
    redrawCanvas(); // Redraw to show selection highlight

    // Position and show the menu
    contextMenu.style.left = `${clientX}px`;
    contextMenu.style.top = `${clientY}px`;
    contextMenu.classList.remove("hidden");

    const isPinned = item.isPinned === true;
    pinBtn.textContent = isPinned ? "📌 Unpin Item" : "📌 Pin Item";
    pinBtn.title = isPinned ? "Unpin this item so it can be deleted" : "Pin this item to prevent deletion";

    deleteBtn.disabled = isPinned;
    deleteBtn.title = isPinned ? "Cannot delete a pinned item" : "Delete this item";
    // Adjust style for disabled state if needed (CSS might handle :disabled)
    if (isPinned) {
      deleteBtn.style.opacity = 0.5;
      deleteBtn.style.cursor = 'not-allowed';
    } else {
      deleteBtn.style.opacity = 1;
      deleteBtn.style.cursor = 'pointer';
    }

    // Toggle visibility of context menu items based on selected item type
    const canDownload =
      (item.type === "file" || item.type === "image") && item.content;
    downloadBtn.classList.toggle("hidden", !canDownload);
    editTagsBtn.classList.remove("hidden"); // Always show tag button for any selected item

    const isTextItem = item.type === "text";
    copyTextBtn.classList.toggle("hidden", !isTextItem);
    if (isTextItem) {
      textToCopy = String(item.content || ""); // Store the full content
      console.log(
        `[Client] Stored text content for potential copy (item ${item.id}).`
      );
    }
  }

  function hideContextMenu() {
    if (!contextMenu.classList.contains("hidden")) {
      contextMenu.classList.add("hidden");
    }
    if (textToCopy !== null) {
      console.log("[Client] Clearing stored text content.");
      textToCopy = null;
    }
    // Don't deselect item here, selection persists until click elsewhere or ESC etc.
  }

  function updateBookmarksList() {
    // Clear existing options except the default placeholder
    bookmarksList.options.length = 1;
    bookmarksList.value = ""; // Reset selection
    // Add current bookmarks as options
    bookmarks.forEach((bm) => {
      const option = document.createElement("option");
      option.value = bm.bookmarkID;
      option.textContent = bm.name;
      bookmarksList.appendChild(option);
    });
  }

  // --- Navigation Functions ---
  function applyZoom(zoomFactor, screenAnchorX, screenAnchorY) {
    // Calculate world point before zoom
    const worldPos = screenToWorld(screenAnchorX, screenAnchorY);

    // Calculate new zoom level, clamped
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor));

    // Calculate new offset to keep world point under screen anchor
    offsetX = screenAnchorX - worldPos.x * newZoom;
    offsetY = screenAnchorY - worldPos.y * newZoom;

    // Apply the new zoom level
    zoom = newZoom;
  }

  function animateView(
    targetOffsetX,
    targetOffsetY,
    targetZoom,
    duration = 300
  ) {
    // Smoothly animates the view (offsetX, offsetY, zoom)
    if (isNavigatingHistory) {
      // If called during history navigation, just jump to the state
      offsetX = targetOffsetX;
      offsetY = targetOffsetY;
      zoom = targetZoom;
      redrawCanvas();
      redrawMinimap();
      // Don't record history again here
      return;
    }

    const startX = offsetX;
    const startY = offsetY;
    const startZoom = zoom;
    const startTime = performance.now();

    function step(currentTime) {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1); // Normalize time 0-1
      // Ease in-out function: 0.5 * (1 - cos(pi * progress))
      const easedProgress = 0.5 - 0.5 * Math.cos(progress * Math.PI);

      // Interpolate state variables
      zoom = startZoom + (targetZoom - startZoom) * easedProgress;
      offsetX = startX + (targetOffsetX - startX) * easedProgress;
      offsetY = startY + (targetOffsetY - startY) * easedProgress;

      redrawCanvas();
      redrawMinimap();

      if (progress < 1) {
        requestAnimationFrame(step); // Continue animation
      } else {
        // Ensure final state is exact
        zoom = targetZoom;
        offsetX = targetOffsetX;
        offsetY = targetOffsetY;
        // Final redraw might be redundant if last step was close enough
        // redrawCanvas();
        // redrawMinimap();
        // Record history state AFTER animation completes
        recordHistoryState();
      }
    }
    requestAnimationFrame(step);
  }

  function zoomToFitAll(immediate = false) {
    if (!myUserID) return; // Need to be initialized

    const targetItems = items; // Fit all items
    if (targetItems.length === 0) {
      // If canvas is empty, reset to a default view
      const defaultOffsetX = canvas.clientWidth / 2; // Center origin roughly
      const defaultOffsetY = canvas.clientHeight / 2;
      const defaultZoom = 0.5; // Default zoom level
      if (immediate) {
        offsetX = defaultOffsetX;
        offsetY = defaultOffsetY;
        zoom = defaultZoom;
        redrawCanvas();
        redrawMinimap();
      } else {
        animateView(defaultOffsetX, defaultOffsetY, defaultZoom);
      }
      return;
    }

    zoomToItems(targetItems, immediate); // Use helper function
  }

  function zoomToItems(itemsToFit, immediate = false) {
    if (!Array.isArray(itemsToFit) || itemsToFit.length === 0) return;

    const bounds = calculateWorldBounds(itemsToFit, 50); // Get bounds + padding
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;

    // Calculate zoom to fit bounds, clamped and with margin
    const zoomX = canvasWidth / bounds.width;
    const zoomY = canvasHeight / bounds.height;
    const targetZoom = Math.max(
      MIN_ZOOM,
      Math.min(zoomX, zoomY, MAX_ZOOM) * 0.9
    ); // Fit with 10% margin

    // Calculate offset to center the bounds in the view
    const targetOffsetX =
      canvasWidth / 2 - (bounds.minX + bounds.width / 2) * targetZoom;
    const targetOffsetY =
      canvasHeight / 2 - (bounds.minY + bounds.height / 2) * targetZoom;

    if (immediate) {
      offsetX = targetOffsetX;
      offsetY = targetOffsetY;
      zoom = targetZoom;
      redrawCanvas();
      redrawMinimap();
      // Don't record history for immediate jumps usually? Or maybe do? Let's skip for now.
    } else {
      animateView(targetOffsetX, targetOffsetY, targetZoom); // Animates and records history
    }
  }

  // --- History Management ---
  function recordHistoryState() {
    if (isNavigatingHistory) return; // Don't record history generated by history navigation

    clearTimeout(historyTimeout); // Debounce: Reset timer if view changes again quickly
    historyTimeout = setTimeout(() => {
      const currentState = { x: offsetX, y: offsetY, zoom: zoom };

      // Prevent duplicates if view hasn't changed meaningfully
      const lastState = historyBackStack[historyBackStack.length - 1];
      if (
        lastState &&
        Math.abs(lastState.x - currentState.x) < 1 && // Tolerance for small changes
        Math.abs(lastState.y - currentState.y) < 1 &&
        Math.abs(lastState.zoom - currentState.zoom) < 0.01
      ) {
        return; // Skip if state is essentially the same
      }

      historyBackStack.push(currentState);
      // Limit history stack size? e.g., historyBackStack = historyBackStack.slice(-50);
      historyForwardStack = []; // Clear forward stack when a new action is taken
      updateHistoryButtons();
      console.log(
        `History state recorded. Back: ${historyBackStack.length}, Fwd: ${historyForwardStack.length}`
      );
    }, HISTORY_DEBOUNCE);
  }

  function navigateHistory(direction) {
    isNavigatingHistory = true; // Set flag to prevent recording this navigation
    let targetState = null;
    const currentState = { x: offsetX, y: offsetY, zoom: zoom };

    if (direction === "back" && historyBackStack.length > 0) {
      historyForwardStack.push(currentState); // Push current state to forward stack
      targetState = historyBackStack.pop();
    } else if (direction === "forward" && historyForwardStack.length > 0) {
      historyBackStack.push(currentState); // Push current state to back stack
      targetState = historyForwardStack.pop();
    }

    if (targetState) {
      // Animate or jump to the target state
      // animateView will check isNavigatingHistory and jump immediately
      animateView(targetState.x, targetState.y, targetState.zoom);
    }

    updateHistoryButtons();
    // Reset flag after a short delay to allow jump/animation to start
    setTimeout(() => {
      isNavigatingHistory = false;
    }, 50);
  }

  function updateHistoryButtons() {
    historyBackBtn.disabled = historyBackStack.length === 0;
    historyForwardBtn.disabled = historyForwardStack.length === 0;
  }

  // --- Event Listeners ---

  // Nickname Dialog
  nicknameSubmitBtn.addEventListener("click", () => {
    const nick = nicknameInput.value;
    nicknameError.classList.add("hidden"); // Hide previous error
    if (nick && nick.trim().length > 0 && nick.length <= 30) {
      socket.emit("set-nickname", nick.trim());
    } else {
      nicknameError.textContent = "Name must be 1-30 characters.";
      nicknameError.classList.remove("hidden");
    }
  });
  nicknameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      nicknameSubmitBtn.click();
    }
  });


  // Toolbar Buttons
  qrToggleBtn.addEventListener("click", () => {
    console.log("share button clicked")
    qrContainer.classList.toggle("hidden");
    if (true) {
      console.log("fetch block entered")
      // Fetch QR code if opening and not already loaded
      fetch("/qrcode")
        .then((res) =>
          res.ok ? res.json() : Promise.reject(`HTTP error ${res.status}`)
        )
        .then((data) => {
          if (data.qrDataUrl && data.serverUrl) {
            qrCodeImg.src = data.qrDataUrl;
            serverUrlSpan.textContent = ` ${data.serverUrl}`;
            qrCodeImg.alt = `QR Code for ${data.serverUrl}`;
            console.log("qr code loaded:", data.qrDataUrl);
          } else {
            console.log("share button clicked")
            throw new Error("Invalid QR data received");

          }
        })
        .catch((err) => {
          console.error("Failed to load QR code:", err);
          serverUrlSpan.textContent = " Error loading QR";
          qrCodeImg.alt = "Error loading QR code";
          qrCodeImg.src = ""; // Clear potentially broken image src
        });
    }
  });
  qrCloseBtn.addEventListener("click", () =>
    qrContainer.classList.add("hidden")
  );

  clearCanvasBtn.addEventListener("click", () => {
    if (!myUserID) return; // Must be identified
    if (
      confirm(
        "Are you sure you want to clear the canvas for everyone?\nPinned items will NOT be removed.\nThis cannot be undone for unpinned items."
      )
    ) {
      console.log("Requesting canvas clear...");
      socket.emit("clear-canvas");
    }
  });

  uploadBtn.addEventListener("click", () => {
    if (myUserID) fileInput.click(); // Trigger hidden file input
  });
  fileInput.addEventListener("change", (e) => {
    if (!myUserID || !e.target.files || e.target.files.length === 0) return;
    // Get center of current view as default drop position
    const centerScreenX = canvas.clientWidth / 2;
    const centerScreenY = canvas.clientHeight / 2;
    const worldPos = screenToWorld(centerScreenX, centerScreenY);
    handleFiles(e.target.files, worldPos.x, worldPos.y);
    fileInput.value = ""; // Reset file input
  });

  pasteBtn.addEventListener("click", () => {
    if (!myUserID) return;
    pasteTextarea.value = ""; // Clear previous text
    pasteDialog.classList.remove("hidden");
    pasteTextarea.focus();
  });

  // Paste Dialog Buttons
  pasteDialogAddBtn.addEventListener("click", () => {
    if (!myUserID) return;
    const text = pasteTextarea.value.trim();
    if (text) {
      const centerScreenX = canvas.clientWidth / 2;
      const centerScreenY = canvas.clientHeight / 2;
      const worldPos = screenToWorld(centerScreenX, centerScreenY);
      // Emit add-item event for text
      socket.emit("add-item", {
        type: "text",
        content: text,
        x: worldPos.x,
        y: worldPos.y,
      });
      pasteDialog.classList.add("hidden"); // Close dialog
    } else {
      alert("Please paste some text first.");
    }
  });
  pasteDialogCancelBtn.addEventListener("click", () =>
    pasteDialog.classList.add("hidden")
  );

  // Search/Filter Listener
  searchInput.addEventListener("input", () => {
    if (!myUserID) return;
    const query = searchInput.value;
    // Add debounce later if needed for performance
    socket.emit("filter-items", {
      query: query,
      // filters: getActiveFilters() // Implement filter logic later
    });
    // Highlights are updated when 'filter-results' event is received
  });
  // Add listeners for filterTypeBtn, filterDateBtn, filterTagBtn later

  // Navigation Listeners
  zoomInBtn.addEventListener("click", () => {
    if (!myUserID) return;
    const centerScreenX = canvas.clientWidth / 2;
    const centerScreenY = canvas.clientHeight / 2;
    applyZoom(1.2, centerScreenX, centerScreenY); // Zoom in centered
    redrawCanvas();
    redrawMinimap();
    recordHistoryState(); // Record state after zoom
  });
  zoomOutBtn.addEventListener("click", () => {
    if (!myUserID) return;
    const centerScreenX = canvas.clientWidth / 2;
    const centerScreenY = canvas.clientHeight / 2;
    applyZoom(1 / 1.2, centerScreenX, centerScreenY); // Zoom out centered
    redrawCanvas();
    redrawMinimap();
    recordHistoryState(); // Record state after zoom
  });
  zoomFitBtn.addEventListener("click", () => zoomToFitAll()); // Animates by default

  historyBackBtn.addEventListener("click", () => navigateHistory("back"));
  historyForwardBtn.addEventListener("click", () => navigateHistory("forward"));

  saveViewBtn.addEventListener('click', () => {
    if (!myUserID) return; // Must be identified
    bookmarkNameInput.value = ''; // Clear previous input
    bookmarkError.classList.add('hidden'); // Hide previous error
    bookmarkDialog.classList.remove('hidden'); // Show the modal
    bookmarkNameInput.focus(); // Focus the input field
  });

  bookmarkSaveBtn.addEventListener('click', () => {
    if (!myUserID) return;
    const name = bookmarkNameInput.value.trim();
    bookmarkError.classList.add('hidden'); // Hide error initially

    // Basic validation (e.g., non-empty and max length)
    if (name && name.length > 0 && name.length <= 50) {
      console.log(`Saving bookmark: "${name}"`);
      socket.emit('save-bookmark', {
        name: name, // Use the validated name from input
        view: { x: offsetX, y: offsetY, zoom: zoom }, // Current view state
      });
      bookmarkDialog.classList.add('hidden'); // Hide dialog on success
    } else {
      // Show error message inside the dialog
      bookmarkError.textContent = 'Bookmark name must be 1-50 characters.';
      bookmarkError.classList.remove('hidden');
    }
  });

  bookmarkCancelBtn.addEventListener('click', () => {
    bookmarkDialog.classList.add('hidden'); // Just hide the dialog
    bookmarkError.classList.add('hidden'); // Also clear error on cancel
  });

  // Optional: Add Enter key listener for the bookmark name input
  bookmarkNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent potential form submission
      bookmarkSaveBtn.click(); // Trigger the save button click
    }
  });

  bookmarksList.addEventListener("change", (e) => {
    if (!myUserID) return;
    const bookmarkID = e.target.value;
    if (bookmarkID) {
      const bookmark = bookmarks.find((b) => b.bookmarkID === bookmarkID);
      if (bookmark && bookmark.view) {
        // Saved view state contains offsetX, offsetY, zoom
        animateView(bookmark.view.x, bookmark.view.y, bookmark.view.zoom);
      }
    }
    bookmarksList.value = ""; // Reset dropdown after selection/navigation
  });

  // Organization Listeners
  gridSnapToggle.addEventListener("click", () => {
    isSnapEnabled = !isSnapEnabled;
    gridSnapToggle.style.backgroundColor = isSnapEnabled ? "#a0e0a0" : ""; // Visual feedback
    redrawCanvas(); // Redraw to show/hide grid
    console.log("Grid Snap Toggled:", isSnapEnabled);
  });

  // --- Canvas Interactions ---

  // Direct Paste (Ctrl+V / Cmd+V)
  canvas.addEventListener("paste", (e) => {
    if (!myUserID) return; // Must be identified
    e.preventDefault();
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Determine paste position (center of current view)
    const centerScreenX = canvas.clientWidth / 2;
    const centerScreenY = canvas.clientHeight / 2;
    const worldPos = screenToWorld(centerScreenX, centerScreenY);
    console.log(
      `Paste event at world ${worldPos.x.toFixed(0)}, ${worldPos.y.toFixed(0)}`
    );

    // Check for files first
    const files = clipboardData.files;
    if (files && files.length > 0) {
      console.log(`Pasting ${files.length} file(s)`);
      handleFiles(files, worldPos.x, worldPos.y);
      return; // Stop processing if files handled
    }

    // Check for image data (often available as blob/file or specific types)
    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        const blob = items[i].getAsFile();
        if (blob) {
          console.log(`Pasting image blob: ${blob.name || "clipboard_image"}`);
          handlePastedImageBlob(blob, worldPos.x, worldPos.y);
          return; // Stop processing if image handled
        }
      }
    }

    // Check for plain text last
    if (clipboardData.types.includes("text/plain")) {
      const text = clipboardData.getData("text/plain").trim();
      if (text) {
        console.log(`Pasting text: ${text.substring(0, 50)}...`);
        socket.emit("add-item", {
          type: "text",
          content: text,
          x: worldPos.x,
          y: worldPos.y,
        });
        return; // Stop processing
      }
    }

    console.log("No suitable content found in paste event.");
  });

  // Drag and Drop Files
  canvas.addEventListener("dragover", (e) => {
    e.preventDefault(); // Necessary to allow drop
    e.dataTransfer.dropEffect = "copy";
    // Add visual indicator if desired (e.g., changing canvas border)
  });
  canvas.addEventListener("dragleave", () => {
    // Remove visual indicator if added
  });
  canvas.addEventListener("drop", (e) => {
    if (!myUserID) return;
    e.preventDefault(); // Prevent browser's default file handling
    // Remove visual indicator if added

    // Calculate drop position in world coordinates
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const worldPos = screenToWorld(screenX, screenY);
    console.log(
      `Drop event at world ${worldPos.x.toFixed(0)}, ${worldPos.y.toFixed(0)}`
    );

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFiles(files, worldPos.x, worldPos.y);
    } else {
      console.log("Drop event occurred but no files found.");
    }
  });

  // Mouse Dragging / Panning
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !myUserID) return; // Only main button (left), ensure user is identified

    canvas.focus(); // Ensure canvas has focus for keyboard events etc.
    hideContextMenu();
    const worldPos = getMousePos(canvas, e);
    if (!worldPos) return;

    const clickedItem = getItemAtPos(worldPos.x, worldPos.y);

    if (clickedItem) {
      // --- Start Dragging Item ---
      isDragging = true;
      isPanning = false; // Ensure panning is false
      draggedItem = clickedItem;
      // Select the item if not already selected
      if (!selectedItem || selectedItem.id !== draggedItem.id) {
        selectedItem = draggedItem;
        redrawCanvas(); // Show selection immediately
      }
      // Store starting positions
      dragStartX_world = worldPos.x;
      dragStartY_world = worldPos.y;
      itemStartX_world = draggedItem.x;
      itemStartY_world = draggedItem.y;
      canvas.style.cursor = "grabbing";
    } else {
      // --- Start Panning ---
      isDragging = false; // Ensure dragging is false
      isPanning = true;
      draggedItem = null; // No item being dragged
      // Store starting screen coordinates for panning delta calculation
      const rect = canvas.getBoundingClientRect();
      panStartX = e.clientX - rect.left;
      panStartY = e.clientY - rect.top;
      canvas.style.cursor = "grabbing";
      // Deselect any selected item when starting pan in empty space
      if (selectedItem) {
        selectedItem = null;
        redrawCanvas(); // Update visually
      }
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    if (!myUserID) return; // Ignore if not identified

    const rect = canvas.getBoundingClientRect();
    const currentScreenX = e.clientX - rect.left;
    const currentScreenY = e.clientY - rect.top;
    const currentWorldPos = screenToWorld(currentScreenX, currentScreenY);

    if (isDragging && draggedItem) {
      // --- Dragging Item ---
      // Calculate the difference in world coordinates from drag start
      const deltaX_world = currentWorldPos.x - dragStartX_world;
      const deltaY_world = currentWorldPos.y - dragStartY_world;
      // Calculate proposed new item position
      let newX_world = itemStartX_world + deltaX_world;
      let newY_world = itemStartY_world + deltaY_world;

      // Apply snapping if enabled
      if (isSnapEnabled) {
        newX_world = Math.round(newX_world / GRID_SIZE) * GRID_SIZE;
        newY_world = Math.round(newY_world / GRID_SIZE) * GRID_SIZE;
      }

      // Update item position locally for smooth feedback
      draggedItem.x = newX_world;
      draggedItem.y = newY_world;
      // If the dragged item is the selected item, ensure the selected reference is updated (it should be the same object)
      // if (selectedItem && selectedItem.id === draggedItem.id) { selectedItem = draggedItem; } // Not strictly needed if references are correct

      redrawCanvas();
      // Optimisation: Redraw minimap less frequently during drag? For now, redraw always.
      redrawMinimap();
    } else if (isPanning) {
      // --- Panning Canvas ---
      // Calculate screen delta
      const dx = currentScreenX - panStartX;
      const dy = currentScreenY - panStartY;
      // Update canvas offset
      offsetX += dx;
      offsetY += dy;
      // Update pan start position for next move event
      panStartX = currentScreenX;
      panStartY = currentScreenY;
      redrawCanvas();
      redrawMinimap(); // Update minimap view indicator during pan
    } else {
      // --- Hovering ---
      // Change cursor based on whether hovering over an item
      canvas.style.cursor = getItemAtPos(currentWorldPos.x, currentWorldPos.y)
        ? "grab"
        : "crosshair";
    }

    // --- Send Presence Update (Throttled) ---
    // Send current viewport center as presence data
    sendPresenceUpdate();
  });

  canvas.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !myUserID) return; // Only main button

    if (isDragging && draggedItem) {
      // --- End Dragging Item ---
      // Apply snapping one last time to be sure
      let finalX = draggedItem.x;
      let finalY = draggedItem.y;
      if (isSnapEnabled) {
        finalX = Math.round(finalX / GRID_SIZE) * GRID_SIZE;
        finalY = Math.round(finalY / GRID_SIZE) * GRID_SIZE;
        // Update local item data before sending
        draggedItem.x = finalX;
        draggedItem.y = finalY;
        redrawCanvas(); // Show final snapped position
        redrawMinimap();
      }

      console.log(
        `Item ${draggedItem.id} drag end. Pos: (${finalX.toFixed(
          1
        )}, ${finalY.toFixed(1)})`
      );
      // Send final position update to server
      socket.emit("update-item", { id: draggedItem.id, x: finalX, y: finalY });
      recordHistoryState(); // Record history after drag interaction
    } else if (isPanning) {
      // --- End Panning ---
      recordHistoryState(); // Record history after panning interaction
    }

    // Reset interaction states
    isDragging = false;
    isPanning = false;
    draggedItem = null;
    // Reset cursor based on final hover position (handled by next mousemove)
    canvas.style.cursor = getItemAtPos(
      getMousePos(canvas, e)?.x,
      getMousePos(canvas, e)?.y
    )
      ? "grab"
      : "crosshair";
  });

  canvas.addEventListener("mouseleave", () => {
    // Treat mouse leaving canvas similar to mouseup for ending interactions
    if (!myUserID) return;

    if (isDragging && draggedItem) {
      // If dragging, finalize the drag at the last known position
      const finalX = draggedItem.x;
      const finalY = draggedItem.y;
      console.log(
        `Item ${draggedItem.id
        } drag cancel (mouseleave). Pos: (${finalX.toFixed(
          1
        )}, ${finalY.toFixed(1)})`
      );
      socket.emit("update-item", { id: draggedItem.id, x: finalX, y: finalY });
      recordHistoryState();
    } else if (isPanning) {
      // If panning, just record the final state
      recordHistoryState();
    }

    // Reset states regardless
    isDragging = false;
    isPanning = false;
    draggedItem = null;
    canvas.style.cursor = "crosshair"; // Reset cursor
  });

  // --- Touch Interactions ---
  // Using passive: false for touchmove to allow preventDefault conditionally
  // Using passive: true for touchstart can improve scroll performance if default isn't prevented

  canvas.addEventListener(
    "touchstart",
    (e) => {
      if (!myUserID) return;
      // Don't preventDefault here if possible, use touch-action CSS
      canvas.focus();
      hideContextMenu();

      // Store initial touch points info
      touchStartPoints.clear();
      Array.from(e.touches).forEach((touch) => {
        touchStartPoints.set(touch.identifier, {
          clientX: touch.clientX,
          clientY: touch.clientY,
          time: Date.now(),
        });
      });

      if (e.touches.length === 1) {
        // --- Single Touch Start ---
        isPinching = false; // Ensure pinch is off
        const worldPos = getTouchPos(canvas, e);
        if (!worldPos) return;
        const touchedItem = getItemAtPos(worldPos.x, worldPos.y);

        if (touchedItem) {
          // Start dragging item
          isDragging = true;
          isPanning = false;
          draggedItem = touchedItem;
          if (!selectedItem || selectedItem.id !== draggedItem.id) {
            selectedItem = draggedItem;
            redrawCanvas(); // Show selection
          }
          dragStartX_world = worldPos.x;
          dragStartY_world = worldPos.y;
          itemStartX_world = draggedItem.x;
          itemStartY_world = draggedItem.y;
        } else {
          // Start panning
          isDragging = false;
          isPanning = true;
          draggedItem = null;
          const touch = e.touches[0];
          const rect = canvas.getBoundingClientRect();
          panStartX = touch.clientX - rect.left;
          panStartY = touch.clientY - rect.top;
          if (selectedItem) {
            selectedItem = null; // Deselect on pan start
            redrawCanvas();
          }
        }
      } else if (e.touches.length === 2) {
        // --- Two Touch Start (Pinch) ---
        isDragging = false; // Stop item drag if starting pinch
        isPanning = false; // Stop pan if starting pinch
        isPinching = true;
        draggedItem = null; // Ensure no item is being dragged

        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        pinchStartDistance = Math.sqrt(dx * dx + dy * dy);

        // Calculate pinch center in screen coordinates
        const rect = canvas.getBoundingClientRect();
        touchCenterX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        touchCenterY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
      } else {
        // More than 2 touches - ignore for now, reset flags
        isDragging = false;
        isPanning = false;
        isPinching = false;
        draggedItem = null;
      }
    },
    { passive: true }
  ); // Use passive for start if not preventing default

  canvas.addEventListener(
    "touchmove",
    (e) => {
      if (!myUserID) return;

      if (isPinching && e.touches.length === 2) {
        // --- Pinch Zoom ---
        e.preventDefault(); // Prevent default browser pinch zoom/scroll
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        const currentDistance = Math.sqrt(dx * dx + dy * dy);

        if (pinchStartDistance > 0) {
          // Avoid division by zero
          const zoomFactor = currentDistance / pinchStartDistance;
          // Apply zoom anchored at the initial pinch center
          applyZoom(zoomFactor, touchCenterX, touchCenterY);
          pinchStartDistance = currentDistance; // Update start distance for next move
          // Update pinch center? Maybe not, keep initial anchor point.
          // const rect = canvas.getBoundingClientRect();
          // touchCenterX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
          // touchCenterY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
          redrawCanvas();
          redrawMinimap();
        }
      } else if (isDragging && e.touches.length === 1 && draggedItem) {
        // --- Dragging Item (Single Touch) ---
        e.preventDefault(); // Prevent scrolling while dragging item
        const worldPos = getTouchPos(canvas, e);
        if (!worldPos) return;

        const deltaX_world = worldPos.x - dragStartX_world;
        const deltaY_world = worldPos.y - dragStartY_world;
        let newX_world = itemStartX_world + deltaX_world;
        let newY_world = itemStartY_world + deltaY_world;

        if (isSnapEnabled) {
          newX_world = Math.round(newX_world / GRID_SIZE) * GRID_SIZE;
          newY_world = Math.round(newY_world / GRID_SIZE) * GRID_SIZE;
        }
        draggedItem.x = newX_world;
        draggedItem.y = newY_world;
        redrawCanvas();
        redrawMinimap();
        // Send presence update? Less critical during touch?
      } else if (isPanning && e.touches.length === 1) {
        // --- Panning (Single Touch) ---
        e.preventDefault(); // Prevent scrolling while panning
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const currentScreenX = touch.clientX - rect.left;
        const currentScreenY = touch.clientY - rect.top;
        const dx = currentScreenX - panStartX;
        const dy = currentScreenY - panStartY;
        offsetX += dx;
        offsetY += dy;
        panStartX = currentScreenX; // Update pan start for next delta
        panStartY = currentScreenY;
        redrawCanvas();
        redrawMinimap();
      }
      // Send presence update based on viewport change?
      sendPresenceUpdate();
    },
    { passive: false }
  ); // Needs passive: false to allow preventDefault

  canvas.addEventListener("touchend", (e) => {
    if (!myUserID) return;
    const stillTouchingCount = e.touches.length;
    const wasDragging = isDragging; // Capture state before reset
    const wasPanning = isPanning;
    const wasPinching = isPinching;

    // --- Finalize Drag ---
    if (wasDragging && draggedItem) {
      let finalX = draggedItem.x;
      let finalY = draggedItem.y;
      if (isSnapEnabled) {
        finalX = Math.round(finalX / GRID_SIZE) * GRID_SIZE;
        finalY = Math.round(finalY / GRID_SIZE) * GRID_SIZE;
        draggedItem.x = finalX; // Update local item data
        draggedItem.y = finalY;
        redrawCanvas(); // Show final snapped pos
        redrawMinimap();
      }
      console.log(
        `Item ${draggedItem.id} touch drag end. Pos: (${finalX.toFixed(
          1
        )}, ${finalY.toFixed(1)})`
      );
      socket.emit("update-item", { id: draggedItem.id, x: finalX, y: finalY });
      recordHistoryState(); // Record history after interaction
    }

    // --- Detect Tap ---
    let didTap = false;
    // Check if the touch end corresponds to a quick, short tap
    if (
      stillTouchingCount === 0 &&
      !wasDragging &&
      !wasPanning &&
      !wasPinching &&
      e.changedTouches.length === 1
    ) {
      const endedTouch = e.changedTouches[0];
      const startData = touchStartPoints.get(endedTouch.identifier);
      if (startData) {
        const tapDuration = Date.now() - startData.time;
        const dx = endedTouch.clientX - startData.clientX;
        const dy = endedTouch.clientY - startData.clientY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const MAX_TAP_DURATION = 300; // ms
        const MAX_TAP_DISTANCE = 15; // screen pixels

        if (tapDuration < MAX_TAP_DURATION && distance < MAX_TAP_DISTANCE) {
          didTap = true;
          // Get tap position in world coordinates
          const worldPos = screenToWorld(
            endedTouch.clientX - canvas.getBoundingClientRect().left,
            endedTouch.clientY - canvas.getBoundingClientRect().top
          );
          const tappedItem = getItemAtPos(worldPos.x, worldPos.y);
          if (tappedItem) {
            console.log("Tap detected on item:", tappedItem.id);
            // Show context menu near the tap position
            showContextMenu(endedTouch.clientX, endedTouch.clientY, tappedItem);
          } else {
            console.log("Tap detected on empty space.");
            hideContextMenu(); // Hide if tapping empty space
            if (selectedItem) {
              selectedItem = null; // Deselect if tapping empty space
              redrawCanvas();
            }
          }
        }
      }
    }

    // Record history after pan/pinch end if it wasn't a tap or drag end
    if (!didTap && !wasDragging && (wasPanning || wasPinching)) {
      recordHistoryState();
    }

    // --- Reset States ---
    // If less than 2 fingers remain, pinch state ends
    if (stillTouchingCount < 2) {
      isPinching = false;
      pinchStartDistance = 0;
    }
    // If no fingers remain, all interaction states end
    if (stillTouchingCount < 1) {
      isDragging = false;
      isPanning = false;
      draggedItem = null;
      // Don't reset selectedItem here, tap logic handles selection/deselection
    }

    // If transitioning from pinch (2 touches) to single touch, potentially start panning/dragging?
    // This logic can be complex. For now, ending pinch simply stops that mode. A new touchstart
    // would be needed to begin dragging/panning with the remaining finger.

    // Clean up touch start points for fingers that lifted
    Array.from(e.changedTouches).forEach((touch) => {
      touchStartPoints.delete(touch.identifier);
    });
  });

  canvas.addEventListener("touchcancel", (e) => {
    // Treat cancel like touchend for ending interactions and resetting state
    if (!myUserID) return;
    console.log("Touch cancel event");

    if (isDragging && draggedItem) {
      const finalX = draggedItem.x;
      const finalY = draggedItem.y;
      console.log(
        `Item ${draggedItem.id} touch drag CANCEL. Pos: (${finalX.toFixed(
          1
        )}, ${finalY.toFixed(1)})`
      );
      socket.emit("update-item", { id: draggedItem.id, x: finalX, y: finalY });
      recordHistoryState();
    } else if (isPanning || isPinching) {
      recordHistoryState();
    }
    // Reset all interaction states
    isDragging = false;
    isPanning = false;
    isPinching = false;
    draggedItem = null;
    pinchStartDistance = 0;
    touchStartPoints.clear(); // Clear all start points on cancel
  });

  // Mouse Wheel Zoom
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!myUserID) return;
      e.preventDefault(); // Prevent page scrolling
      const delta = e.deltaY > 0 ? 0.9 : 1.1; // Zoom factor based on scroll direction
      // Get mouse position relative to canvas for zoom anchor
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      applyZoom(delta, mouseX, mouseY); // Apply zoom anchored at mouse pointer
      redrawCanvas();
      redrawMinimap();
      recordHistoryState(); // Record history after wheel zoom
    },
    { passive: false }
  ); // Need passive: false to preventDefault

  // --- Minimap Interaction ---
  let isDraggingMinimap = false;

  minimapCanvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || !myUserID) return;
    isDraggingMinimap = true;
    handleMinimapJump(e); // Jump view on initial click
    minimapCanvas.style.cursor = "grabbing";
  });

  minimapCanvas.addEventListener("mousemove", (e) => {
    if (!isDraggingMinimap || !myUserID) return;
    handleMinimapJump(e); // Update view continuously while dragging on minimap
  });

  minimapCanvas.addEventListener("mouseup", (e) => {
    if (e.button !== 0 || !isDraggingMinimap) return;
    isDraggingMinimap = false;
    minimapCanvas.style.cursor = "pointer";
    // Record history state after finishing minimap navigation
    recordHistoryState();
  });

  minimapCanvas.addEventListener("mouseleave", () => {
    if (isDraggingMinimap) {
      // If dragging stops because mouse left minimap, record history
      recordHistoryState();
    }
    isDraggingMinimap = false;
    minimapCanvas.style.cursor = "pointer";
  });

  function handleMinimapJump(event) {
    const dpr = window.devicePixelRatio || 1; // Needed? No, clientWidth/Height are CSS pixels
    const miniRect = minimapCanvas.getBoundingClientRect();
    const minimapX = event.clientX - miniRect.left; // Click position in minimap CSS pixels
    const minimapY = event.clientY - miniRect.top;

    // Map minimap click coords back to world coords
    const worldBounds = calculateWorldBounds(items, 200); // Use consistent padding
    const scaleX = minimapCanvas.clientWidth / worldBounds.width;
    const scaleY = minimapCanvas.clientHeight / worldBounds.height;
    const minimapScale = Math.min(scaleX, scaleY) * 0.95; // Use same scale as drawing

    if (minimapScale <= 0 || !isFinite(minimapScale)) return; // Avoid errors

    // Calculate minimap offset used during drawing
    const offsetX_mm =
      (minimapCanvas.clientWidth - worldBounds.width * minimapScale) / 2 -
      worldBounds.minX * minimapScale;
    const offsetY_mm =
      (minimapCanvas.clientHeight - worldBounds.height * minimapScale) / 2 -
      worldBounds.minY * minimapScale;

    // Convert minimap click coords -> world coords
    const worldClickX = (minimapX - offsetX_mm) / minimapScale;
    const worldClickY = (minimapY - offsetY_mm) / minimapScale;

    // Center the main canvas view on this world coordinate, preserving current zoom
    const canvasWidth = canvas.clientWidth;
    const canvasHeight = canvas.clientHeight;
    offsetX = canvasWidth / 2 - worldClickX * zoom;
    offsetY = canvasHeight / 2 - worldClickY * zoom;

    redrawCanvas();
    redrawMinimap(); // Redraw minimap to update the viewbox position immediately
  }

  // --- Context Menu (Right Click) ---
  canvas.addEventListener("contextmenu", (e) => {
    if (!myUserID) return;
    e.preventDefault(); // Prevent default browser context menu
    const worldPos = getMousePos(canvas, e);
    if (!worldPos) return;

    const item = getItemAtPos(worldPos.x, worldPos.y);
    if (item) {
      // Show context menu for the clicked item
      showContextMenu(e.clientX, e.clientY, item);
    } else {
      // Clicked on empty space
      hideContextMenu();
      // Deselect item if clicking empty space with right-click
      if (selectedItem) {
        selectedItem = null;
        redrawCanvas();
      }
    }
  });

  // Context Menu Button Actions
  deleteBtn.addEventListener("click", () => {
    if (selectedItem && myUserID) {
      console.log(`Requesting delete for item: ${selectedItem.id}`);
      socket.emit("delete-item", selectedItem.id);
      hideContextMenu();
      // selectedItem = null; // Deselect locally immediately? Or wait for server confirmation? Wait is safer.
    }
  });

  copyTextBtn.addEventListener("click", () => {
    // Check if there is text stored from the context menu action
    if (textToCopy !== null && myUserID) {
      console.log(
        "[Client] Copy button clicked, attempting to copy stored text using document.execCommand."
      );

      let success = false;
      const tempTextArea = document.createElement("textarea");

      try {
        // Style to hide the textarea off-screen
        tempTextArea.style.position = "fixed";
        tempTextArea.style.left = "-9999px";
        tempTextArea.style.top = "-9999px";
        tempTextArea.value = textToCopy; // Put the stored text into the textarea

        document.body.appendChild(tempTextArea); // Add to DOM
        tempTextArea.select(); // Select the text
        tempTextArea.setSelectionRange(0, textToCopy.length); // Ensure full selection for mobile etc.

        // Execute the copy command
        success = document.execCommand("copy");

        if (success) {
          console.log(
            "[Client] Text copied successfully using document.execCommand."
          );
          // Visual feedback
          const originalText = copyTextBtn.textContent;
          copyTextBtn.textContent = "Copied!";
          setTimeout(() => {
            if (copyTextBtn) copyTextBtn.textContent = originalText;
          }, 1500);
        } else {
          console.error(
            '[Client] document.execCommand("copy") returned false or threw error.'
          );
          alert(
            "Could not copy text using execCommand. Browser might not support it or permission denied."
          );
        }
      } catch (err) {
        console.error(
          '[Client] Error during document.execCommand("copy"):',
          err
        );
        alert("An error occurred while trying to copy text.");
      } finally {
        // IMPORTANT: Clean up the temporary textarea
        if (tempTextArea) {
          document.body.removeChild(tempTextArea);
        }
        // Hide the menu AFTER the operation attempt
        hideContextMenu(); // This will also clear textToCopy
      }
    } else {
      console.warn(
        "Copy action triggered but no text was stored or user not identified."
      );
      hideContextMenu();
    }
  });

  downloadBtn.addEventListener("click", () => {
    // Check if there's a selected item with content and it's either a file or an image
    if (
      selectedItem &&
      selectedItem.content &&
      (selectedItem.type === "file" || selectedItem.type === "image")
    ) {
      try {
        const link = document.createElement("a");
        link.href = selectedItem.content; // Works for file paths and data URLs

        // Determine filename: use originalName if available, otherwise provide defaults
        if (selectedItem.type === "file") {
          link.download = selectedItem.originalName || "download"; // Default for files
        } else {
          // type === 'image'
          link.download = selectedItem.originalName || "canvas_image.png"; // Default for images
        }

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        console.log(
          `Download initiated for ${selectedItem.type}: ${link.download}`
        );
      } catch (error) {
        console.error("Error initiating download:", error);
        alert("Could not initiate download."); // Inform user
      } finally {
        hideContextMenu(); // Hide menu after attempt
        // Deselect after action? Optional, keeping it selected for now.
        // selectedItem = null;
        // redrawCanvas();
      }
    } else {
      console.warn(
        "Download button clicked, but no suitable item selected or item lacks content."
      );
      hideContextMenu(); // Hide menu even if no action taken
    }
  });

  editTagsBtn.addEventListener("click", () => {
    if (selectedItem && myUserID) {
      currentItemForTagEditing = selectedItem; // Store reference to item being edited
      tagEditorTitle.textContent = `Edit Tags: ${selectedItem.originalName || selectedItem.type
        }`;
      populateTagEditor(selectedItem.tags || []); // Populate editor with current tags
      tagEditorDialog.classList.remove("hidden"); // Show editor modal
      newTagInput.focus();
      hideContextMenu(); // Hide the right-click menu
    }
  });

  pinBtn.addEventListener("click", () => {
    if (selectedItem && myUserID) {
      console.log(`Requesting toggle pin for item: ${selectedItem.id}`);
      socket.emit("toggle-pin-item", selectedItem.id);
      // Optimistic UI update? Maybe wait for server 'item-updated' event is safer
      // selectedItem.isPinned = !selectedItem.isPinned;
      // redrawCanvas();
      hideContextMenu(); // Hide menu after action
    }
  });

  // --- Tag Editor Logic ---
  function populateTagEditor(tags) {
    currentTagsContainer.innerHTML = ""; // Clear existing tag pills
    tags.forEach((tag) => {
      const tagElement = document.createElement("span");
      tagElement.className = "tag-pill"; // Assign class for styling
      tagElement.textContent = tag;
      const removeBtn = document.createElement("button");
      removeBtn.textContent = "x";
      removeBtn.title = `Remove tag "${tag}"`;
      removeBtn.onclick = (e) => {
        e.stopPropagation(); // Prevent potential modal closure
        removeTagFromEditor(tag);
      };
      tagElement.appendChild(removeBtn);
      currentTagsContainer.appendChild(tagElement);
    });
    newTagInput.value = ""; // Clear input field
  }

  function addTagFromInput() {
    const newTag = newTagInput.value.trim().substring(0, 30); // Limit tag length
    if (newTag && currentItemForTagEditing) {
      // Ensure tags array exists
      if (!Array.isArray(currentItemForTagEditing.tags)) {
        currentItemForTagEditing.tags = [];
      }
      // Add tag only if it's not already present (case-sensitive for now)
      if (!currentItemForTagEditing.tags.includes(newTag)) {
        // Update tags locally for immediate UI feedback
        currentItemForTagEditing.tags.push(newTag);
        populateTagEditor(currentItemForTagEditing.tags); // Refresh tag pills
      }
      newTagInput.value = ""; // Clear input field after adding
    }
  }

  function removeTagFromEditor(tagToRemove) {
    if (
      !currentItemForTagEditing ||
      !Array.isArray(currentItemForTagEditing.tags)
    )
      return;
    // Filter out the tag to remove
    currentItemForTagEditing.tags = currentItemForTagEditing.tags.filter(
      (t) => t !== tagToRemove
    );
    populateTagEditor(currentItemForTagEditing.tags); // Refresh tag pills
  }

  addTagBtn.addEventListener("click", addTagFromInput);
  newTagInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // Prevent default form submission behavior
      addTagFromInput();
    }
  });

  tagEditorDoneBtn.addEventListener("click", () => {
    if (currentItemForTagEditing && myUserID) {
      console.log(
        `Saving tags for item ${currentItemForTagEditing.id}:`,
        currentItemForTagEditing.tags
      );
      // Send the final list of tags to the server
      socket.emit("update-item-tags", {
        id: currentItemForTagEditing.id,
        tags: currentItemForTagEditing.tags || [], // Send current tags array
      });
    }
    tagEditorDialog.classList.add("hidden"); // Close the dialog
    currentItemForTagEditing = null; // Clear reference
    // Selection state remains unchanged unless user clicks elsewhere
  });
  // Add listener for closing tag editor via cancel/backdrop click later if needed

  // --- Global Click Listener (for hiding menus/deselecting) ---
  document.addEventListener(
    "click",
    (e) => {
      if (document.body.classList.contains("disconnected")) return; // Ignore clicks if disconnected
      // Hide context menu if clicking outside of it
      if (
        !contextMenu.classList.contains("hidden") &&
        !contextMenu.contains(e.target)
      ) {
        // ... (rest of context menu hiding logic) ...
        const clickTargetIsButtonInsideMenu =
          contextMenu.contains(e.target) && e.target.tagName === "BUTTON";
        if (!clickTargetIsButtonInsideMenu) {
          hideContextMenu();
          // Optional: Deselect item if clicking on canvas background
          if (
            selectedItem &&
            e.target === canvas &&
            !getItemAtPos(getMousePos(canvas, e)?.x, getMousePos(canvas, e)?.y)
          ) {
            selectedItem = null;
            redrawCanvas();
          }
        }
      }

      // Close tag editor if clicking outside? (Might need refinement)
      //   if (!tagEditorDialog.classList.contains("hidden") && !tagEditorDialog.contains(e.target) && e.target !== editTagsBtn) {
      // Maybe prompt if changes are unsaved? For now, don't close automatically.
      // tagEditorDialog.classList.add('hidden');
      // currentItemForTagEditing = null;
      //   }

      // Deselect item if clicking on canvas background (not on an item or menu)
      if (
        selectedItem &&
        e.target === canvas &&
        !getItemAtPos(getMousePos(canvas, e)?.x, getMousePos(canvas, e)?.y)
      ) {
        // This check might be redundant as mousedown on empty space already handles deselection
        // selectedItem = null;
        // redrawCanvas();
      }
    },
    true
  ); // Use capture phase to catch clicks early

  // --- Action Handlers (Adding Items) ---

  function handlePastedImageBlob(blob, worldX, worldY) {
    if (!blob || !blob.type.startsWith("image/") || !myUserID) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      socket.emit("add-item", {
        type: "image",
        content: e.target.result, // base64 data URL
        x: worldX,
        y: worldY,
        originalName: blob.name || "pasted_image.png",
      });
    };
    reader.onerror = (err) => {
      console.error("FileReader error reading pasted image:", err);
      alert("Failed to read pasted image data.");
    };
    reader.readAsDataURL(blob);
  }

  function handleFiles(fileList, dropWorldX, dropWorldY) {
    if (!fileList || fileList.length === 0 || !myUserID) return;

    const uploadProgressContainer = document.getElementById(
      "upload-progress-container"
    );
    if (!uploadProgressContainer) {
      console.error("Upload progress container element not found!");
      // Fallback: Show the old generic loading indicator if the new container is missing
      loadingIndicator.classList.remove("hidden");
      // Still attempt to process files without detailed progress UI
    } else {
      // Make the container visible if it's not already
      uploadProgressContainer.classList.remove("hidden");
      uploadProgressContainer.style.display = "flex"; // Ensure flex display is set
      // Hide the old generic loading indicator if we are using the new system
      loadingIndicator.classList.add("hidden");
    }

    console.log(
      `Handling ${fileList.length} file(s) at world (${dropWorldX.toFixed(
        0
      )}, ${dropWorldY.toFixed(0)})`
    );

    const spacingX_world = 50; // Horizontal spacing for multiple files in world coordinates
    const spacingY_world = 0; // Vertical spacing

    // --- Helper Function to Manage Progress UI ---
    const manageProgressUI = (uploadId, status, value = 0, message = "") => {
      const element = document.getElementById(uploadId);
      if (!element) return; // Element might have been removed already

      const progressBar = element.querySelector(".progress-bar");
      const progressText = element.querySelector(".progress-text");
      const filenameSpan = element.querySelector(".filename");

      // Reset classes first
      element.classList.remove("processing", "completed", "error", "fade-out");

      switch (status) {
        case "processing":
          element.classList.add("processing");
          if (progressBar) {
            progressBar.style.width = "100%"; // Indicate activity
            progressBar.style.transition = "none"; // No transition for processing indication
          }
          if (progressText) progressText.textContent = "Processing";
          break;
        case "uploading":
          if (progressBar) {
            progressBar.style.transition = "width 0.15s linear"; // Restore transition
            progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
          }
          if (progressText)
            progressText.textContent = `${Math.round(
              Math.max(0, Math.min(100, value))
            )}%`;
          break;
        case "completed":
          element.classList.add("completed");
          if (progressBar) progressBar.style.width = "100%";
          if (progressText) progressText.textContent = "Done";
          // Add fade-out class, then remove after animation
          element.classList.add("fade-out");
          setTimeout(() => {
            element.remove();
            checkHideProgressContainer(); // Check if container should be hidden
          }, 600); // Corresponds to CSS transition duration
          break;
        case "error":
          element.classList.add("error");
          if (progressBar) progressBar.style.width = "100%"; // Indicate error state
          if (progressText) progressText.textContent = "Error";
          if (filenameSpan) filenameSpan.title = message || "Upload failed"; // Show error on hover
          // Add fade-out class, then remove after animation (longer delay for errors)
          element.classList.add("fade-out");
          setTimeout(() => {
            element.remove();
            checkHideProgressContainer(); // Check if container should be hidden
          }, 5000); // Keep error visible longer
          break;
        default: // E.g., 'waiting' or initial state
          if (progressBar) progressBar.style.width = "0%";
          if (progressText) progressText.textContent = "Waiting...";
      }
    };

    // --- Helper Function to Check if Container Should Be Hidden ---
    const checkHideProgressContainer = () => {
      if (
        uploadProgressContainer &&
        uploadProgressContainer.children.length === 0
      ) {
        uploadProgressContainer.classList.add("hidden");
        uploadProgressContainer.style.display = "none"; // Explicitly hide
      }
    };

    // --- Process Each File ---
    Array.from(fileList).forEach((file, index) => {
      const uploadId = `upload-${Date.now()}-${index}`; // Simple unique ID for the UI element

      // Calculate item position in world coordinates
      let fileX = dropWorldX + index * spacingX_world;
      let fileY = dropWorldY + index * spacingY_world;
      if (isSnapEnabled) {
        fileX = Math.round(fileX / GRID_SIZE) * GRID_SIZE;
        fileY = Math.round(fileY / GRID_SIZE) * GRID_SIZE;
      }

      // Create the progress UI element only if the container exists
      if (uploadProgressContainer) {
        const progressElement = document.createElement("div");
        progressElement.id = uploadId;
        progressElement.className = "upload-progress-item";
        progressElement.innerHTML = `
                <span class="filename" title="${file.name}">${file.name}</span>
                <div class="progress-info">
                    <div class="progress-bar-container">
                        <div class="progress-bar"></div>
                    </div>
                    <span class="progress-text">0%</span>
                </div>
            `;
        uploadProgressContainer.appendChild(progressElement);
      } else {
        // If container doesn't exist, we can't show progress, but still log
        console.log(`Starting processing for ${file.name} (no UI container)`);
      }

      // --- Handle File Type ---
      // --- Handle ALL file types by uploading via XMLHttpRequest ---
      // No special FileReader case for images anymore

      // Immediately set state to uploading for UI feedback
      manageProgressUI(uploadId, "uploading", 0);

      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append("file", file); // Field name matches server multer config

      // Progress Handler (remains the same)
      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) {
          const percentComplete = (event.loaded / event.total) * 100;
          manageProgressUI(uploadId, "uploading", percentComplete);
        } else {
          console.log(`Upload progress not computable for ${file.name}`);
        }
      });

      // Completion Handler (Load event - Modified to determine item type)
      xhr.addEventListener("load", () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Success statuses
          try {
            const result = JSON.parse(xhr.responseText);
            // Check if server returned expected data
            if (result && result.path && result.originalname && result.mimetype) { // Check mimetype exists
              // Determine item type based on mimetype from server response
              const itemType = result.mimetype.startsWith('image/') ? 'image' : 'file'; // <-- Key change here

              socket.emit("add-item", {
                type: itemType,                 // <-- Use determined type
                content: result.path,           // Server path (e.g., /uploads/uuid.ext)
                x: fileX,
                y: fileY,
                originalName: result.originalname,
                mimetype: result.mimetype,      // Store mimetype
                // Width/Height for images will be determined on first draw by drawImage
              });
              manageProgressUI(uploadId, "completed");
            } else {
              console.error(`Invalid success response for ${file.name}:`, xhr.responseText);
              manageProgressUI(uploadId, "error", 0, "Invalid server response");
            }
          } catch (parseError) {
            console.error(`Error parsing upload response for ${file.name}:`, parseError, xhr.responseText);
            manageProgressUI(uploadId, "error", 0, "Server response error");
          }
        } else {
          // Handle HTTP error status (4xx, 5xx)
          let errorMsg = `Upload failed (${xhr.status})`;
          try {
            const errorJson = JSON.parse(xhr.responseText);
            errorMsg = errorJson.error || errorMsg;
          } catch (_) { /* Ignore parsing error */ }
          console.error(`Upload failed for ${file.name}: ${xhr.status} ${xhr.statusText}`, xhr.responseText);
          manageProgressUI(uploadId, "error", 0, errorMsg);
        }
      });

      // Network Error Handler (remains the same)
      xhr.addEventListener("error", () => {
        console.error(`Network error during upload for ${file.name}`);
        manageProgressUI(uploadId, "error", 0, "Network error");
      });

      // Abort Handler (remains the same)
      xhr.addEventListener("abort", () => {
        console.log(`Upload aborted for ${file.name}`);
        manageProgressUI(uploadId, "error", 0, "Aborted"); // Or just remove silently
      });

      // Send the request (remains the same)
      xhr.open("POST", "/upload", true);
      xhr.send(formData);

      // --- End of XHR block --- (This comment helps clarify the pasted block ends here)
    });

    // Initial check in case no files were processed (e.g., empty fileList)
    checkHideProgressContainer();
  }

  // --- Presence Update Sending (Throttled) ---
  let lastPresenceUpdateTime = 0;
  const PRESENCE_UPDATE_INTERVAL = 150; // ms interval for sending updates

  function sendPresenceUpdate() {
    const now = Date.now();
    // Only send if identified and enough time has passed
    if (!myUserID || now - lastPresenceUpdateTime < PRESENCE_UPDATE_INTERVAL) {
      return;
    }

    lastPresenceUpdateTime = now;
    // Calculate the center of the current view in world coordinates
    const centerScreenX = canvas.clientWidth / 2;
    const centerScreenY = canvas.clientHeight / 2;
    const worldCenter = screenToWorld(centerScreenX, centerScreenY);

    // Send presence data (current viewport)
    socket.emit("update-presence", {
      type: "view", // Indicate the type of presence data
      view: {
        x: worldCenter.x,
        y: worldCenter.y,
        zoom: zoom,
      },
      // Could add cursor position later:
      // cursor: { x: worldMousePos?.x, y: worldMousePos?.y }
    });
  }

  document.addEventListener(
    "click",
    (e) => {
      // Check if the context menu is visible AND the click was NOT inside the menu itself
      if (
        !contextMenu.classList.contains("hidden") &&
        !contextMenu.contains(e.target)
      ) {
        // Additionally, check if the click was NOT the initial right-click that opened the menu
        // (prevents immediate closure if right-click happens near menu boundary).
        // We can approximate this by checking if the target is part of the canvas or outside.
        // A click on a menu button is handled by the button's own listener.
        const clickTargetIsButtonInsideMenu =
          contextMenu.contains(e.target) && e.target.tagName === "BUTTON";

        if (!clickTargetIsButtonInsideMenu) {
          console.log(
            "[Client] Global click detected outside context menu, hiding menu."
          );
          hideContextMenu(); // Hide the menu (clears textToCopy)

          // Optional: Deselect item if clicking on canvas background
          if (
            selectedItem &&
            e.target === canvas &&
            !getItemAtPos(getMousePos(canvas, e)?.x, getMousePos(canvas, e)?.y)
          ) {
            selectedItem = null;
            redrawCanvas();
          }
        }
      }
    },
    true
  ); // Use capture phase to catch clicks reliably

  // Send presence periodically even if idle?
  // setInterval(sendPresenceUpdate, 2000); // Send every 2s regardless of activity

  // --- Initial Load / Final Setup ---
  console.log("Client script initialized and running.");
  // Initial resize is called via timeout
  // Canvas drawing/interaction is blocked until nickname is set and 'init' received
  updateHistoryButtons(); // Initialize history button state
}); // End DOMContentLoaded
