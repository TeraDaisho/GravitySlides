// Open side panel on icon click
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

// Listen for messages from the side panel
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "resizeWindow169") {
    resizeTo169();
  }
});

async function resizeTo169() {
  const window = await chrome.windows.getCurrent();

  // Target: Content 16:9 + Side Panel to fit inside a standard 1366px laptop screen.
  // Content: 960x540 (16:9)
  // Side Panel: 320px
  // Chrome Borders: ~20px
  // Total Width: 960 + 320 = 1280 (Safe for almost all screens)
  // Total Height: 540 + ~120 (Chrome UI) = ~660

  const targetWidth = 1280;
  const targetHeight = 660;

  await chrome.windows.update(window.id, {
    width: targetWidth,
    height: targetHeight,
    state: "normal"
  });
}
