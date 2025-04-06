// public/client.js
document.addEventListener("DOMContentLoaded", () => {
  const socket = io();

  // --- DOM Elements ---
  const canvas = document.getElementById("canvas");
  const ctx = canvas.getContext("2d", { alpha: false }); // Improve performance if no transparency needed
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
  const loadingIndicator = document.getElementById("loading-indicator");
  const contextMenu = document.getElementById("context-menu");
  const deleteBtn = document.getElementById("delete-btn");
  const downloadBtn = document.getElementById("download-btn");
  const pasteDialog = document.getElementById("paste-dialog");
  const pasteTextarea = document.getElementById("paste-textarea");
  const pasteDialogAddBtn = document.getElementById("paste-dialog-add-btn");
  const pasteDialogCancelBtn = document.getElementById(
    "paste-dialog-cancel-btn"
  );

  // --- State ---
  let items = []; // Local cache of canvas items {id, type, content, x, y, width?, height?, originalName?, color?, font?}
  let selectedItem = null; // Store the actual item object for context menu actions
  let draggedItem = null; // The item currently being dragged (via mouse or touch)
  const imageCache = {}; // { contentUrlOrData: ImageObject } - Cache for loaded images

  // --- Canvas Viewport State ---
  let zoom = 0.5; // Initial zoom level (10%)
  let offsetX = 0; // Pan offset X
  let offsetY = 0; // Pan offset Y
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 5.0;
  let isDragging = false; // Dragging an *item*
  let dragStartX_world, dragStartY_world; // Start pos of item drag in world coords
  let itemStartX_world, itemStartY_world; // Start pos of the item itself in world coords

  let isPanning = false; // Panning the canvas *background*
  let panStartX, panStartY; // Start pos of pan in screen coords

  // Touch specific state
  let pinchStartDistance = 0;
  let touchCenterX = 0;
  let touchCenterY = 0;
  let isPinching = false;
  let touchStartPoints = new Map(); // Store initial touch points for tap vs drag detection

  // --- Canvas Setup ---
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr); // Scale context once here

    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    console.log(
      `Canvas resized: ${canvas.width}x${canvas.height} (CSS: ${rect.width}x${rect.height}), DPR: ${dpr}`
    );
    redrawCanvas();
  }

  window.addEventListener("resize", resizeCanvas);
  setTimeout(resizeCanvas, 50); // Initial size calculation

  // --- Coordinate Transformations ---
  function screenToWorld(screenX, screenY) {
    const dpr = window.devicePixelRatio || 1;
    return {
      x: (screenX - offsetX) / zoom,
      y: (screenY - offsetY) / zoom,
    };
  }

  function worldToScreen(worldX, worldY) {
    const dpr = window.devicePixelRatio || 1;
    return {
      x: worldX * zoom + offsetX,
      y: worldY * zoom + offsetY,
    };
  }

  // --- Drawing Logic ---
  function redrawCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.width / dpr;
    const cssHeight = canvas.height / dpr;

    ctx.save(); // Save default state

    // --- Clear Canvas ---
    // Set transform to identity temporarily to clear the screen space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // Apply DPR scaling only
    ctx.fillStyle = "#e9e9e9"; // Background color
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    // --- Apply Viewport Transform ---
    ctx.translate(offsetX, offsetY); // Apply pan
    ctx.scale(zoom, zoom); // Apply zoom

    // --- Draw Items ---
    items.forEach((item) => {
      // Use item's actual world data for drawing
      const drawX = item.x || 0;
      const drawY = item.y || 0;

      // Draw selection highlight (in world space)
      if (selectedItem && item.id === selectedItem.id) {
        ctx.strokeStyle = "rgba(0, 100, 255, 0.7)";
        // Adjust line width slightly based on zoom, but keep it visible
        ctx.lineWidth = Math.max(1, 2 / zoom) / dpr;
        ctx.strokeRect(
          drawX - 2 / zoom, // Adjust padding based on zoom
          drawY - 2 / zoom,
          (item.width || 0) + 4 / zoom,
          (item.height || 0) + 4 / zoom
        );
      }

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
            console.warn(`Unknown item type: ${item.type}`);
        }
      } catch (error) {
        console.error(
          `Error drawing item ${item.id} (type: ${item.type}):`,
          error,
          item
        );
        drawErrorPlaceholder(item);
      }
    });

    ctx.restore(); // Restore default state (removes transform)
  }

  // --- Drawing Specific Item Types ---

  // ** MODIFIED drawText to draw a card and wrap text **
  function drawText(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;
    const maxWidth = 250; // Max width of text card in world units
    const padding = 10; // Padding inside the card in world units
    const fontSize = 16; // Base font size in world units
    const lineHeight = fontSize * 1.2; // Line height

    ctx.font = `${fontSize}px Arial`; // Use world-based font size
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // --- Text Wrapping ---
    const lines = [];
    const words = item.content.split(" ");
    let currentLine = "";
    words.forEach((word) => {
      const testLine = currentLine ? currentLine + " " + word : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth - 2 * padding && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    });
    lines.push(currentLine); // Add the last line

    // --- Calculate Card Dimensions ---
    const textHeight = lines.length * lineHeight;
    const cardWidth = maxWidth; // Use fixed width for simplicity now
    const cardHeight = textHeight + 2 * padding;

    // Store dimensions on the item for hit detection/selection
    item.width = cardWidth;
    item.height = cardHeight;

    // --- Draw Card Background ---
    ctx.fillStyle = item.color || "#ffffff"; // Use item color or default white
    ctx.strokeStyle = "#cccccc"; // Border color
    ctx.lineWidth = 1 / zoom / (window.devicePixelRatio || 1); // Thin border, adjust for zoom
    ctx.fillRect(drawX, drawY, cardWidth, cardHeight);
    ctx.strokeRect(drawX, drawY, cardWidth, cardHeight);

    // --- Draw Wrapped Text ---
    ctx.fillStyle = "#333333"; // Text color
    lines.forEach((line, index) => {
      ctx.fillText(line, drawX + padding, drawY + padding + index * lineHeight);
    });
  }

  function drawImage(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;

    const drawActualImage = (img, item) => {
      const naturalWidth = img.naturalWidth;
      const naturalHeight = img.naturalHeight;
      let targetWidth = item.width;
      let targetHeight = item.height;

      // Initial size calculation if missing (based on 150 world units width)
      if (
        (!targetWidth || !targetHeight) &&
        naturalWidth > 0 &&
        naturalHeight > 0
      ) {
        const aspectRatio = naturalWidth / naturalHeight;
        targetWidth = 150;
        targetHeight = targetWidth / aspectRatio;
        item.width = targetWidth;
        item.height = targetHeight;
        // No need to emit here, size calculated locally is fine for drawing
      } else if (!targetWidth || !targetHeight) {
        targetWidth = 100;
        targetHeight = 100;
        item.width = targetWidth;
        item.height = targetHeight;
      }

      targetWidth = Math.max(10, targetWidth);
      targetHeight = Math.max(10, targetHeight);

      ctx.drawImage(img, drawX, drawY, targetWidth, targetHeight);
    };

    const cacheKey = item.content;
    if (imageCache[cacheKey]) {
      const img = imageCache[cacheKey];
      if (img.complete && img.naturalWidth > 0) {
        drawActualImage(img, item);
      } else if (img.failed) {
        drawErrorPlaceholder(item);
      } else {
        drawLoadingPlaceholder(item);
        if (!img.onload) {
          img.onload = () => {
            if (!img.failed) redrawCanvas();
          };
          img.onerror = () => {
            img.failed = true;
            redrawCanvas();
          };
        }
      }
    } else {
      drawLoadingPlaceholder(item);
      const img = new Image();
      imageCache[cacheKey] = img;
      img.onload = () => {
        if (!item.width || !item.height) {
          // Recalc initial size on load if needed
          const aspectRatio = img.naturalWidth / img.naturalHeight || 1;
          item.width = 150;
          item.height = item.width / aspectRatio;
        }
        redrawCanvas();
      };
      img.onerror = () => {
        img.failed = true;
        if (!item.width) item.width = 100;
        if (!item.height) item.height = 100;
        redrawCanvas();
      };
      img.src = cacheKey;
    }
  }

  function drawFile(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;
    const rectWidth = item.width || 120; // Use stored or default width (world units)
    const rectHeight = item.height || 70; // Use stored or default height (world units)
    item.width = rectWidth; // Ensure size is stored
    item.height = rectHeight;

    ctx.fillStyle = "#f0f0f0";
    ctx.fillRect(drawX, drawY, rectWidth, rectHeight);
    ctx.strokeStyle = "#b0b0b0";
    ctx.lineWidth = 1 / zoom / (window.devicePixelRatio || 1); // Adjust border for zoom
    ctx.strokeRect(drawX, drawY, rectWidth, rectHeight);

    // Adjust icon and text size slightly based on zoom, but keep readable
    const iconSize = Math.max(15, 30 / Math.sqrt(zoom)); // Don't shrink too much
    const fontSize = Math.max(8, 11 / Math.sqrt(zoom));

    ctx.fillStyle = "#777";
    ctx.font = `${iconSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "📄",
      drawX + rectWidth / 2,
      drawY + rectHeight / 2 - fontSize * 0.5
    ); // Adjust pos based on font size

    ctx.fillStyle = "#333";
    ctx.font = `${fontSize}px Arial`;
    const name = item.originalName || "file";
    const maxLen = Math.floor(rectWidth / (fontSize * 0.6)); // Approx chars that fit
    const displayName =
      name.length > maxLen ? name.substring(0, maxLen - 3) + "..." : name;
    ctx.fillText(
      displayName,
      drawX + rectWidth / 2,
      drawY + rectHeight / 2 + fontSize * 1.2 // Position below icon
    );
  }

  function drawLoadingPlaceholder(item) {
    const drawX = item.x || 0;
    const drawY = item.y || 0;
    const width = item.width || 100;
    const height = item.height || 100;
    if (!item.width) item.width = width;
    if (!item.height) item.height = height;

    ctx.fillStyle = "#f9f9f9";
    ctx.fillRect(drawX, drawY, width, height);
    ctx.strokeStyle = "#e0e0e0";
    ctx.lineWidth = 1 / zoom / (window.devicePixelRatio || 1);
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
    const width = item.width || 100;
    const height = item.height || 100;
    if (!item.width) item.width = width;
    if (!item.height) item.height = height;

    ctx.fillStyle = "#ffe0e0";
    ctx.fillRect(drawX, drawY, width, height);
    ctx.strokeStyle = "#ffb0b0";
    ctx.lineWidth = 1 / zoom / (window.devicePixelRatio || 1);
    ctx.strokeRect(drawX, drawY, width, height);

    ctx.fillStyle = "#cc0000";
    const fontSize = Math.max(8, 12 / Math.sqrt(zoom));
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Load Error", drawX + width / 2, drawY + height / 2);
  }

  // --- Socket Event Handlers ---
  socket.on("connect", () => console.log("Connected to server:", socket.id));
  socket.on("disconnect", () => {
    console.log("Disconnected");
    updateUserCount("?");
  });
  socket.on("connect_error", (err) => console.error("Connection Error:", err));

  socket.on("init", (data) => {
    console.log("Received initial state");
    items = data.items || [];
    updateUserCount(data.users !== undefined ? data.users : "?");
    preloadImages(items);
    redrawCanvas(); // Draw after getting initial items
  });

  socket.on("item-added", (item) => {
    const existingIndex = items.findIndex(
      (existing) => existing.id === item.id
    );
    if (existingIndex === -1) {
      items.push(item);
      if (item.type === "image") preloadImages([item]);
      redrawCanvas();
    } else {
      // Update existing item (e.g., confirmation)
      Object.assign(items[existingIndex], item);
      if (item.type === "image") preloadImages([item]);
      redrawCanvas();
    }
  });

  socket.on("item-updated", (updatedItem) => {
    const index = items.findIndex((item) => item.id === updatedItem.id);
    if (index !== -1) {
      // Preserve local selection state if the update is for the selected item
      const isCurrentlySelected =
        selectedItem && selectedItem.id === updatedItem.id;
      Object.assign(items[index], updatedItem);
      if (updatedItem.type === "image") preloadImages([updatedItem]);
      // If the updated item was selected, ensure selectedItem points to the updated object
      if (isCurrentlySelected) {
        selectedItem = items[index];
      }
      redrawCanvas();
    }
  });

  socket.on("item-deleted", (id) => {
    const index = items.findIndex((item) => item.id === id);
    if (index !== -1) {
      items.splice(index, 1);
      if (selectedItem && selectedItem.id === id) selectedItem = null;
      redrawCanvas();
    }
  });

  socket.on("canvas-cleared", () => {
    console.log("Canvas cleared by server");
    items = [];
    selectedItem = null;
    Object.keys(imageCache).forEach((key) => delete imageCache[key]);
    // Reset view? Optional, maybe keep current pan/zoom
    // zoom = 0.1; offsetX = 0; offsetY = 0;
    redrawCanvas();
  });

  socket.on("user-count", (count) => updateUserCount(count));

  // --- Helper Functions ---
  function updateUserCount(count) {
    userCountSpan.textContent = `Users: ${count}`;
  }

  function preloadImages(itemList) {
    itemList.forEach((item) => {
      if (
        item.type === "image" &&
        item.content &&
        typeof item.content === "string" &&
        !imageCache[item.content]
      ) {
        const cacheKey = item.content;
        const img = new Image();
        imageCache[cacheKey] = img;
        img.onload = () => {
          redrawCanvas();
        }; // Redraw needed when image loads sizes might change
        img.onerror = () => {
          img.failed = true;
          redrawCanvas();
        };
        img.src = cacheKey;
      }
    });
  }

  // ** MODIFIED to return WORLD coordinates **
  function getMousePos(canvasElement, event) {
    const rect = canvasElement.getBoundingClientRect();
    // Get mouse position in CSS pixels relative to canvas top-left
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    // Convert screen coordinates to world coordinates
    return screenToWorld(screenX, screenY);
  }

  // ** MODIFIED to return WORLD coordinates **
  function getTouchPos(canvasElement, event) {
    const rect = canvasElement.getBoundingClientRect();
    const touch = event.touches[0] || event.changedTouches[0];
    if (!touch) return null;
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;
    return screenToWorld(screenX, screenY);
  }

  // ** Works with WORLD coordinates **
  function isPointInItem(worldX, worldY, item) {
    if (!item || typeof item.x === "undefined" || typeof item.y === "undefined")
      return false;
    // Use dimensions stored on the item (world units)
    const width = item.width || 1; // Use calculated width
    const height = item.height || 1; // Use calculated height
    return (
      worldX >= item.x &&
      worldX <= item.x + width &&
      worldY >= item.y &&
      worldY <= item.y + height
    );
  }

  // ** Works with WORLD coordinates **
  function getItemAtPos(worldX, worldY) {
    // Iterate backwards so top items are checked first
    for (let i = items.length - 1; i >= 0; i--) {
      if (isPointInItem(worldX, worldY, items[i])) {
        return items[i];
      }
    }
    return null;
  }

  // --- Context Menu ---
  function showContextMenu(clientX, clientY, item) {
    hideContextMenu();
    selectedItem = item;
    redrawCanvas(); // Show selection highlight
    contextMenu.style.left = `${clientX}px`; // Position using screen coords
    contextMenu.style.top = `${clientY}px`;
    contextMenu.classList.remove("hidden");

    if (item.type === "file" && item.content) {
      downloadBtn.classList.remove("hidden");
    } else {
      downloadBtn.classList.add("hidden");
    }
  }

  function hideContextMenu() {
    if (!contextMenu.classList.contains("hidden")) {
      contextMenu.classList.add("hidden");
    }
    downloadBtn.classList.add("hidden");
    // Deselection happens on click/touch outside or on empty space
  }

  // --- Event Listeners ---

  // Toolbar Buttons
  qrToggleBtn.addEventListener("click", () => {
    qrContainer.classList.toggle("hidden");
    if (!qrContainer.classList.contains("hidden") && !qrCodeImg.src) {
      fetch("/qrcode")
        .then((res) =>
          res.ok ? res.json() : Promise.reject(`HTTP error ${res.status}`)
        )
        .then((data) => {
          if (data.qrDataUrl && data.serverUrl) {
            qrCodeImg.src = data.qrDataUrl;
            serverUrlSpan.textContent = ` ${data.serverUrl}`;
            qrCodeImg.alt = `QR Code for ${data.serverUrl}`;
          } else throw new Error("Invalid QR data");
        })
        .catch((err) => {
          console.error("Failed to load QR code:", err);
          serverUrlSpan.textContent = " Error loading QR";
          qrCodeImg.alt = "Error loading QR code";
          qrCodeImg.src = "";
        });
    }
  });
  qrCloseBtn.addEventListener("click", () =>
    qrContainer.classList.add("hidden")
  );

  clearCanvasBtn.addEventListener("click", () => {
    if (
      confirm("Clear the entire canvas for everyone? This cannot be undone.")
    ) {
      socket.emit("clear-canvas");
    }
  });

  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length > 0) {
      // Place near center of the current view
      const dpr = window.devicePixelRatio || 1;
      const centerScreenX = canvas.width / dpr / 2;
      const centerScreenY = canvas.height / dpr / 2;
      const worldPos = screenToWorld(centerScreenX, centerScreenY);
      handleFiles(e.target.files, worldPos.x, worldPos.y);
    }
    fileInput.value = "";
  });

  // ** MODIFIED Paste Button Listener **
  pasteBtn.addEventListener("click", () => {
    pasteTextarea.value = ""; // Clear textarea
    pasteDialog.classList.remove("hidden"); // Show dialog
    pasteTextarea.focus(); // Focus textarea
  });

  // Paste Dialog Button Listeners
  pasteDialogAddBtn.addEventListener("click", () => {
    const text = pasteTextarea.value;
    if (text && text.trim().length > 0) {
      // Place in the center of the current view
      const dpr = window.devicePixelRatio || 1;
      const centerScreenX = canvas.width / dpr / 2;
      const centerScreenY = canvas.height / dpr / 2;
      const worldPos = screenToWorld(centerScreenX, centerScreenY);

      console.log(
        "Emitting add-item for text via dialog:",
        text.substring(0, 20) + "..."
      );
      socket.emit("add-item", {
        type: "text",
        content: text,
        x: worldPos.x,
        y: worldPos.y,
      });
      pasteDialog.classList.add("hidden"); // Hide dialog
    } else {
      alert("Please paste some text into the box first.");
    }
  });

  pasteDialogCancelBtn.addEventListener("click", () => {
    pasteDialog.classList.add("hidden");
  });

  // --- Canvas Interactions ---

  // Direct Paste (Ctrl+V / Cmd+V) - Still useful for images/files
  canvas.addEventListener("paste", (e) => {
    e.preventDefault();

    // Calculate paste position in world coordinates (center view)
    const dpr = window.devicePixelRatio || 1;
    const centerScreenX = canvas.width / dpr / 2;
    const centerScreenY = canvas.height / dpr / 2;
    const worldPos = screenToWorld(centerScreenX, centerScreenY);
    console.log(
      `Attempting direct paste at world coords ${worldPos.x.toFixed(
        0
      )}, ${worldPos.y.toFixed(0)}`
    );

    let handled = false;
    const files = e.clipboardData.files;
    if (files && files.length > 0) {
      console.log(`Pasting ${files.length} file(s)`);
      handleFiles(files, worldPos.x, worldPos.y);
      handled = true;
    }

    if (!handled) {
      const items = e.clipboardData.items;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith("image/")) {
          const blob = items[i].getAsFile();
          if (blob) {
            console.log("Found image blob, pasting image.");
            handlePastedImageBlob(blob, worldPos.x, worldPos.y);
            handled = true;
            break;
          }
        }
      }
    }

    // Don't handle text paste here anymore, use the dialog button
    // if (!handled) {
    //   const text = e.clipboardData.getData("text/plain");
    //   if (text) { /* ... */ }
    // }

    if (!handled) {
      console.log(
        "No suitable image/file found in paste event to handle directly."
      );
    }
  });

  // Drag and Drop Files
  canvas.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  canvas.addEventListener("dragleave", () => {});
  canvas.addEventListener("drop", (e) => {
    e.preventDefault();
    // Get drop position in screen coordinates first
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    // Convert to world coordinates
    const worldPos = screenToWorld(screenX, screenY);

    let handled = false;
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      console.log(
        `Dropped ${files.length} file(s) at world ${worldPos.x.toFixed(
          0
        )}, ${worldPos.y.toFixed(0)}`
      );
      handleFiles(files, worldPos.x, worldPos.y);
      handled = true;
    }

    // Don't handle dropped text, less common and paste dialog preferred
    // if (!handled) {
    //     const text = e.dataTransfer.getData("text/plain");
    //     if (text) { /* ... */ }
    // }
    if (!handled) console.log("Drop event occurred but no files handled.");
  });

  // --- Mouse Dragging (Items) / Panning (Background) ---
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return; // Only left click

    canvas.focus();
    hideContextMenu();
    const worldPos = getMousePos(canvas, e); // Get world coordinates
    if (!worldPos) return;

    const clickedItem = getItemAtPos(worldPos.x, worldPos.y);

    if (clickedItem) {
      // --- Start Dragging Item ---
      isDragging = true;
      isPanning = false; // Ensure panning is off
      draggedItem = clickedItem;

      // Select the item
      if (selectedItem?.id !== draggedItem.id) {
        selectedItem = draggedItem;
        redrawCanvas(); // Update selection highlight
      }

      // Store starting positions in WORLD coordinates
      dragStartX_world = worldPos.x;
      dragStartY_world = worldPos.y;
      itemStartX_world = draggedItem.x;
      itemStartY_world = draggedItem.y;
      canvas.style.cursor = "grabbing";
    } else {
      // --- Start Panning ---
      isDragging = false; // Ensure dragging is off
      isPanning = true;
      draggedItem = null;

      // Store starting position in SCREEN coordinates for panning delta calculation
      const rect = canvas.getBoundingClientRect();
      panStartX = e.clientX - rect.left;
      panStartY = e.clientY - rect.top;
      canvas.style.cursor = "grabbing";

      // Deselect if clicking empty space
      if (selectedItem) {
        selectedItem = null;
        redrawCanvas();
      }
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const currentScreenX = e.clientX - rect.left;
    const currentScreenY = e.clientY - rect.top;

    if (isDragging && draggedItem) {
      // --- Dragging Item ---
      const currentWorldPos = screenToWorld(currentScreenX, currentScreenY);
      const deltaX_world = currentWorldPos.x - dragStartX_world;
      const deltaY_world = currentWorldPos.y - dragStartY_world;

      const newX_world = itemStartX_world + deltaX_world;
      const newY_world = itemStartY_world + deltaY_world;

      // Local update for smooth feedback
      draggedItem.x = newX_world;
      draggedItem.y = newY_world;
      if (selectedItem && selectedItem.id === draggedItem.id) {
        selectedItem.x = newX_world;
        selectedItem.y = newY_world;
      }
      redrawCanvas();
    } else if (isPanning) {
      // --- Panning Canvas ---
      const dx = currentScreenX - panStartX;
      const dy = currentScreenY - panStartY;

      offsetX += dx;
      offsetY += dy;

      // Update start position for next move event
      panStartX = currentScreenX;
      panStartY = currentScreenY;

      redrawCanvas();
    } else {
      // Optional: Change cursor on hover over items?
      const worldPos = screenToWorld(currentScreenX, currentScreenY);
      if (getItemAtPos(worldPos.x, worldPos.y)) {
        canvas.style.cursor = "grab";
      } else {
        canvas.style.cursor = "crosshair";
      }
    }
  });

  canvas.addEventListener("mouseup", (e) => {
    if (e.button !== 0) return;

    if (isDragging && draggedItem) {
      // --- End Dragging Item ---
      console.log(
        `Item ${
          draggedItem.id
        } mouse drag ended at world ${draggedItem.x.toFixed(
          1
        )}, ${draggedItem.y.toFixed(1)}`
      );
      // Send final world position to server
      socket.emit("update-item", {
        id: draggedItem.id,
        x: draggedItem.x,
        y: draggedItem.y,
      });
    } else if (isPanning) {
      // --- End Panning ---
      // No server update needed for panning
    }

    isDragging = false;
    isPanning = false;
    draggedItem = null;
    canvas.style.cursor = "crosshair"; // Reset cursor
  });

  canvas.addEventListener("mouseleave", () => {
    // If mouse leaves canvas, stop any active drag or pan
    if (isDragging && draggedItem) {
      console.log(
        `Item ${
          draggedItem.id
        } mouse drag cancelled (mouseleave) at world ${draggedItem.x.toFixed(
          1
        )}, ${draggedItem.y.toFixed(1)}`
      );
      socket.emit("update-item", {
        id: draggedItem.id,
        x: draggedItem.x,
        y: draggedItem.y,
      });
    }
    isDragging = false;
    isPanning = false;
    draggedItem = null;
    canvas.style.cursor = "crosshair";
  });

  // --- Touch Dragging / Panning / Pinch Zoom ---

  canvas.addEventListener(
    "touchstart",
    (e) => {
      // e.preventDefault(); // Prevent default touch actions like scrolling page. Handled by touch-action:none now.
      canvas.focus();
      hideContextMenu();
      touchStartPoints.clear(); // Clear previous touch starts
      Array.from(e.touches).forEach((touch) => {
        touchStartPoints.set(touch.identifier, {
          x: touch.clientX,
          y: touch.clientY,
          time: Date.now(),
        });
      });

      if (e.touches.length === 1) {
        // --- Single Touch: Potential Drag or Pan ---
        isPinching = false;
        const touch = e.touches[0];
        const worldPos = getTouchPos(canvas, e); // Get world coordinates
        if (!worldPos) return;

        const touchedItem = getItemAtPos(worldPos.x, worldPos.y);

        if (touchedItem) {
          // Start Dragging Item
          isDragging = true;
          isPanning = false;
          draggedItem = touchedItem;
          if (selectedItem?.id !== draggedItem.id) {
            selectedItem = draggedItem;
            redrawCanvas();
          }
          dragStartX_world = worldPos.x;
          dragStartY_world = worldPos.y;
          itemStartX_world = draggedItem.x;
          itemStartY_world = draggedItem.y;
        } else {
          // Start Panning
          isDragging = false;
          isPanning = true;
          draggedItem = null;
          const rect = canvas.getBoundingClientRect();
          panStartX = touch.clientX - rect.left; // Use screen coords for pan delta
          panStartY = touch.clientY - rect.top;
          if (selectedItem) {
            selectedItem = null;
            redrawCanvas();
          }
        }
      } else if (e.touches.length === 2) {
        // --- Two Touches: Start Pinch Zoom ---
        isDragging = false; // Stop item drag if it started
        isPanning = false; // Stop pan if it started
        isPinching = true;
        draggedItem = null;

        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        pinchStartDistance = Math.sqrt(dx * dx + dy * dy);

        // Calculate midpoint in screen coordinates
        const rect = canvas.getBoundingClientRect();
        touchCenterX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        touchCenterY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
      } else {
        // More than 2 touches, ignore for now
        isDragging = false;
        isPanning = false;
        isPinching = false;
      }
    },
    { passive: false }
  ); // Need passive: false if we ever call preventDefault

  canvas.addEventListener(
    "touchmove",
    (e) => {
      // e.preventDefault(); // Prevent scroll/etc only if we are handling the touch

      if (isPinching && e.touches.length === 2) {
        // --- Pinch Zoom ---
        e.preventDefault(); // Prevent default pinch zoom
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        const currentDistance = Math.sqrt(dx * dx + dy * dy);

        if (pinchStartDistance > 0) {
          const zoomFactor = currentDistance / pinchStartDistance;
          applyZoom(zoomFactor, touchCenterX, touchCenterY); // Apply zoom centered on initial midpoint
          pinchStartDistance = currentDistance; // Update distance for next move
        }
        redrawCanvas();
      } else if (isDragging && e.touches.length === 1 && draggedItem) {
        // --- Dragging Item ---
        e.preventDefault(); // Prevent scrolling while dragging item
        const worldPos = getTouchPos(canvas, e);
        if (!worldPos) return;

        const deltaX_world = worldPos.x - dragStartX_world;
        const deltaY_world = worldPos.y - dragStartY_world;
        const newX_world = itemStartX_world + deltaX_world;
        const newY_world = itemStartY_world + deltaY_world;

        draggedItem.x = newX_world;
        draggedItem.y = newY_world;
        if (selectedItem && selectedItem.id === draggedItem.id) {
          selectedItem.x = newX_world;
          selectedItem.y = newY_world;
        }
        redrawCanvas();
      } else if (isPanning && e.touches.length === 1) {
        // --- Panning ---
        e.preventDefault(); // Prevent scrolling while panning
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const currentScreenX = touch.clientX - rect.left;
        const currentScreenY = touch.clientY - rect.top;

        const dx = currentScreenX - panStartX;
        const dy = currentScreenY - panStartY;
        offsetX += dx;
        offsetY += dy;
        panStartX = currentScreenX;
        panStartY = currentScreenY;
        redrawCanvas();
      }
    },
    { passive: false }
  ); // Need passive: false to call preventDefault

  canvas.addEventListener("touchend", (e) => {
    const endedTouchIds = Array.from(e.changedTouches).map((t) => t.identifier);
    const stillTouchingCount = e.touches.length;

    if (isDragging && draggedItem) {
      // If the touch that was dragging the item ended
      console.log(
        `Item ${
          draggedItem.id
        } touch drag ended at world ${draggedItem.x.toFixed(
          1
        )}, ${draggedItem.y.toFixed(1)}`
      );
      socket.emit("update-item", {
        id: draggedItem.id,
        x: draggedItem.x,
        y: draggedItem.y,
      });
    }

    // Handle potential tap for context menu (simple version)
    if (stillTouchingCount === 0 && !isDragging && !isPanning && !isPinching) {
      const endedTouch = Array.from(e.changedTouches)[0];
      const startData = touchStartPoints.get(endedTouch.identifier);
      if (startData) {
        const tapDuration = Date.now() - startData.time;
        const dx = endedTouch.clientX - startData.x;
        const dy = endedTouch.clientY - startData.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // Thresholds for tap detection
        const MAX_TAP_DURATION = 300; // ms
        const MAX_TAP_DISTANCE = 10; // pixels

        if (tapDuration < MAX_TAP_DURATION && distance < MAX_TAP_DISTANCE) {
          const worldPos = screenToWorld(
            endedTouch.clientX - canvas.getBoundingClientRect().left,
            endedTouch.clientY - canvas.getBoundingClientRect().top
          );
          const tappedItem = getItemAtPos(worldPos.x, worldPos.y);
          if (tappedItem) {
            console.log("Tap detected on item:", tappedItem.id);
            // Show context menu near the tap location
            showContextMenu(endedTouch.clientX, endedTouch.clientY, tappedItem);
            // Prevent other actions like deselection
            return; // Exit early
          }
        }
      }
    }

    // Reset states if all touches are up or transitioning from pinch/drag/pan
    if (stillTouchingCount < 2) {
      isPinching = false;
      pinchStartDistance = 0;
    }
    if (stillTouchingCount < 1) {
      isDragging = false;
      isPanning = false;
      draggedItem = null;
    }

    // If transitioning from 2 touches to 1, restart pan/drag for the remaining touch
    if (wasPinching && stillTouchingCount === 1) {
      isPinching = false; // Ensure pinching stops
      // Immediately start pan/drag based on the remaining touch
      const touch = e.touches[0];
      const worldPos = getTouchPos(canvas, e);
      const touchedItem = getItemAtPos(worldPos.x, worldPos.y);
      if (touchedItem) {
        // Start dragging the item under the remaining finger
        isDragging = true;
        isPanning = false;
        draggedItem = touchedItem;
        if (selectedItem?.id !== draggedItem.id) {
          selectedItem = draggedItem;
          redrawCanvas();
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
        const rect = canvas.getBoundingClientRect();
        panStartX = touch.clientX - rect.left;
        panStartY = touch.clientY - rect.top;
        if (selectedItem) {
          selectedItem = null;
          redrawCanvas();
        }
      }
    }

    const wasPinching = isPinching; // Store state before potentially changing it
    touchStartPoints.clear(); // Clear touch start data on touchend
  });

  canvas.addEventListener("touchcancel", (e) => {
    // Treat cancel like touchend for resetting state
    if (isDragging && draggedItem) {
      console.log(
        `Item ${
          draggedItem.id
        } touch drag cancelled at world ${draggedItem.x.toFixed(
          1
        )}, ${draggedItem.y.toFixed(1)}`
      );
      socket.emit("update-item", {
        id: draggedItem.id,
        x: draggedItem.x,
        y: draggedItem.y,
      });
    }
    isDragging = false;
    isPanning = false;
    isPinching = false;
    draggedItem = null;
    pinchStartDistance = 0;
    touchStartPoints.clear();
  });

  // --- Mouse Wheel Zoom ---
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault(); // Prevent page scrolling

      const delta = e.deltaY > 0 ? 0.9 : 1.1; // Zoom factor (adjust for sensitivity)
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left; // Mouse position in screen coordinates
      const mouseY = e.clientY - rect.top;

      applyZoom(delta, mouseX, mouseY);
      redrawCanvas();
    },
    { passive: false }
  ); // Need passive: false to call preventDefault

  // --- Zoom Application Logic ---
  function applyZoom(zoomFactor, screenAnchorX, screenAnchorY) {
    const worldPos = screenToWorld(screenAnchorX, screenAnchorY); // Point under mouse/finger in world coords before zoom
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * zoomFactor)); // Clamp zoom

    // Calculate new offset to keep the anchor point stationary on screen
    offsetX = screenAnchorX - worldPos.x * newZoom;
    offsetY = screenAnchorY - worldPos.y * newZoom;
    zoom = newZoom; // Update the global zoom state
  }

  // --- Context Menu (Right Click - Desktop) ---
  canvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const worldPos = getMousePos(canvas, e);
    if (!worldPos) return;
    const item = getItemAtPos(worldPos.x, worldPos.y);

    if (item) {
      showContextMenu(e.clientX, e.clientY, item); // Use screen coords for menu position
    } else {
      hideContextMenu();
      if (selectedItem) {
        selectedItem = null;
        redrawCanvas();
      }
    }
  });

  // Context Menu Button Actions
  deleteBtn.addEventListener("click", () => {
    if (selectedItem) {
      socket.emit("delete-item", selectedItem.id);
      hideContextMenu();
      selectedItem = null;
      // Redraw handled by 'item-deleted'
    }
  });

  downloadBtn.addEventListener("click", () => {
    if (selectedItem && selectedItem.type === "file" && selectedItem.content) {
      const link = document.createElement("a");
      link.href = selectedItem.content;
      link.download = selectedItem.originalName || "download";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      hideContextMenu();
      selectedItem = null;
      redrawCanvas();
    }
  });

  // Hide context menu if clicking outside
  document.addEventListener(
    "click",
    (e) => {
      // If the click is outside the context menu AND the target is not the canvas itself
      // (canvas clicks handled by mousedown to select/deselect/pan)
      if (!contextMenu.contains(e.target) && e.target !== canvas) {
        hideContextMenu();
        if (selectedItem) {
          // Deselect if clicking elsewhere on the page
          selectedItem = null;
          redrawCanvas();
        }
      }
    },
    true
  ); // Use capture phase

  // --- Action Handlers (Adding Items) ---

  // handlePastedText is now implicitly handled by the dialog add button

  function handlePastedImageBlob(blob, worldX, worldY) {
    if (!blob || !blob.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      socket.emit("add-item", {
        type: "image",
        content: e.target.result,
        x: worldX,
        y: worldY,
        originalName: blob.name || "pasted_image.png",
      });
    };
    reader.onerror = (err) => {
      console.error("FileReader error:", err);
      alert("Failed to read pasted image data.");
    };
    reader.readAsDataURL(blob);
  }

  function handleFiles(fileList, dropWorldX, dropWorldY) {
    if (!fileList || fileList.length === 0) return;
    console.log(
      `Handling ${fileList.length} file(s) at world ${dropWorldX.toFixed(
        0
      )},${dropWorldY.toFixed(0)}`
    );
    loadingIndicator.classList.remove("hidden");

    // Cascade effect in world coordinates
    let currentX = dropWorldX;
    let currentY = dropWorldY;
    const spacingX_world = 50; // Spacing in world units
    const spacingY_world = 30;

    const uploads = Array.from(fileList).map((file, index) => {
      return new Promise(async (resolve, reject) => {
        const fileX = currentX + index * spacingX_world;
        const fileY = currentY + index * spacingY_world;

        try {
          if (file.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = (e) => {
              socket.emit("add-item", {
                type: "image",
                content: e.target.result,
                x: fileX,
                y: fileY,
                originalName: file.name,
              });
              resolve();
            };
            reader.onerror = (err) =>
              reject(new Error("Failed to read image file"));
            reader.readAsDataURL(file);
          } else {
            const formData = new FormData();
            formData.append("file", file);
            const response = await fetch("/upload", {
              method: "POST",
              body: formData,
            });
            if (!response.ok) {
              let errorMsg = `Upload failed: ${response.status}`;
              try {
                errorMsg = (await response.json()).error || errorMsg;
              } catch (_) {}
              throw new Error(errorMsg);
            }
            const result = await response.json();
            socket.emit("add-item", {
              type: "file",
              content: result.path,
              x: fileX,
              y: fileY,
              originalName: result.originalname,
              mimetype: result.mimetype,
            });
            resolve();
          }
        } catch (error) {
          console.error(`Error handling file ${file.name}:`, error);
          reject(error);
        }
      });
    });

    Promise.allSettled(uploads).then((results) => {
      loadingIndicator.classList.add("hidden");
      const failedCount = results.filter((r) => r.status === "rejected").length;
      if (failedCount > 0) {
        alert(`${failedCount} file(s) could not be added. See console.`);
      }
    });
  }

  // --- Initial Load ---
  console.log("Client script initialized.");
  resizeCanvas(); // Initial setup
  redrawCanvas(); // Initial draw (might be empty)
}); // End DOMContentLoaded
