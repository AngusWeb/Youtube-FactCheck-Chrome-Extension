// ===== GLOBAL VARIABLES AND CONFIGURATION =====
let cachedIconUrl;
try {
  cachedIconUrl = chrome.runtime.getURL("icons/my-icon-white.png");
} catch (error) {
  console.error("[DEBUG] Could not get icon URL:", error);
  cachedIconUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAU..."; // fallback
}

let cachedIconUrl2;
try {
  cachedIconUrl2 = chrome.runtime.getURL("icons/my-icon-white-2.png");
} catch (error) {
  console.error("[DEBUG] Could not get icon URL:", error);
  cachedIconUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAU..."; // fallback
}

// Global state
let isActive = true;
const factCheckCache = {};
let sidebar;
let sidebarVisible = false;
let buttonInjectionAttempts = 0;
const MAX_INJECTION_ATTEMPTS = 3;
let factCheckingInProgress = false;
let factCheckTimeoutId = null;
const FACT_CHECK_TIMEOUT = 22000; // 30 seconds timeout

// ===== UTILITY FUNCTIONS =====

function waitForElement(selector, timeout = 5000) {
  console.log("[DEBUG] waitForElement called for:", selector);
  return new Promise((resolve, reject) => {
    const interval = 100;
    let elapsed = 0;

    function check() {
      const el = document.querySelector(selector);
      if (el) {
        console.log("[DEBUG] Found element:", selector);
        resolve(el);
      } else if (elapsed >= timeout) {
        console.warn("[DEBUG] Element not found within timeout:", selector);
        reject(new Error("Element not found: " + selector));
      } else {
        elapsed += interval;
        setTimeout(check, interval);
      }
    }
    check();
  });
}

function getYouTubeVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("v");
}

function blobToJSON(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

function isVideoPage() {
  return !!document.querySelector("video");
}

function resetUI() {
  console.log("[DEBUG] Resetting UI state...");
  buttonInjectionAttempts = 0;

  // Cancel any ongoing fact check
  if (factCheckingInProgress) {
    factCheckingInProgress = false;
    if (factCheckTimeoutId !== null) {
      clearTimeout(factCheckTimeoutId);
      factCheckTimeoutId = null;
    }
  }

  // Hide sidebar if it's visible and restore layout
  if (sidebarVisible && sidebar) {
    toggleSidebar(false);
  }

  // Remove any existing buttons to prevent duplicates
  const existingFirstButton = document.querySelector(".my-custom-button");
  const existingSecondButton = document.querySelector(".my-second-button");

  if (existingFirstButton && existingFirstButton.parentElement) {
    // If the parent element contains both buttons, remove the entire container
    if (
      existingFirstButton.parentElement.classList.contains(
        "custom-buttons-container"
      )
    ) {
      existingFirstButton.parentElement.remove();
      console.log("[DEBUG] Removed existing button container");
    } else {
      existingFirstButton.remove();
      console.log("[DEBUG] Removed existing first button");
    }
  }

  if (existingSecondButton && !existingFirstButton) {
    // In case the second button exists but not within a container with the first button
    existingSecondButton.remove();
    console.log("[DEBUG] Removed existing second button");
  }

  // Ensure body class is removed
  document.body.classList.remove("sidebar-open");

  // Ensure YouTube elements are restored
  const secondary = document.querySelector("#secondary");
  if (secondary) {
    secondary.style.visibility = "";
    secondary.style.opacity = "";
    secondary.style.pointerEvents = "";
  }
}

// ===== LAYOUT MANAGEMENT =====

function getYouTubeLayoutMode() {
  const watchElement = document.querySelector("ytd-watch-flexy");
  if (!watchElement) return "unknown";

  if (watchElement.hasAttribute("theater")) {
    return "theater";
  } else if (watchElement.hasAttribute("fullscreen")) {
    return "fullscreen";
  } else {
    return "default";
  }
}

function disableTheaterMode() {
  console.log("[DEBUG] Attempting to disable theater mode");

  const watchElement = document.querySelector("ytd-watch-flexy");
  if (watchElement && watchElement.hasAttribute("theater")) {
    console.log("[DEBUG] Found video in theater mode");

    // Look for the theater mode button and click it
    const theaterButton = document.querySelector(".ytp-size-button");
    if (theaterButton) {
      console.log("[DEBUG] Found theater button, clicking it");
      theaterButton.click();
      return true;
    }

    // Try keyboard shortcut as last resort
    console.log("[DEBUG] Trying keyboard shortcut");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "t",
        keyCode: 84,
        which: 84,
        bubbles: true,
      })
    );
    return true;
  }

  console.log("[DEBUG] Not in theater mode or element not found");
  return false;
}

function adjustYouTubeLayout(show) {
  console.log("[DEBUG] Adjusting YouTube layout, show:", show);

  // Get YouTube's main elements
  const secondary = document.querySelector("#secondary");
  const primary = document.querySelector("#primary");
  const columns = document.querySelector("ytd-watch-flexy #columns");

  if (show) {
    // Store original dimensions and positions before making any changes
    if (primary) {
      const primaryStyles = window.getComputedStyle(primary);
      document.documentElement.style.setProperty(
        "--original-primary-width",
        primaryStyles.width
      );
      primary.dataset.originalWidth = primaryStyles.width;
      primary.dataset.originalMarginRight = primaryStyles.marginRight;
    }

    if (columns) {
      columns.dataset.originalDisplay =
        window.getComputedStyle(columns).display;
    }

    // Hide YouTube's secondary (recommendations) without changing layout
    if (secondary) {
      console.log("[DEBUG] secondary if hit");
      secondary.style.visibility = "hidden";
      secondary.style.opacity = "0";
      secondary.style.pointerEvents = "none";
    }

    // Add a class to the body for CSS targeting
    document.body.classList.add("sidebar-open");
  } else {
    // Restore YouTube's secondary content
    if (secondary) {
      secondary.style.visibility = "";
      secondary.style.opacity = "";
      secondary.style.pointerEvents = "";
    }

    // Restore primary to original styling
    if (primary) {
      primary.style.width = primary.dataset.originalWidth || "";
      primary.style.marginRight = primary.dataset.originalMarginRight || "";
    }

    // Restore columns display
    if (columns && columns.dataset.originalDisplay) {
      columns.style.display = columns.dataset.originalDisplay;
    }

    // Remove body class
    document.body.classList.remove("sidebar-open");
  }
}

function getYouTubeSecondaryWidth() {
  const secondary = document.querySelector("#secondary");
  if (secondary) {
    const computedWidth = window.getComputedStyle(secondary).width;
    console.log("[DEBUG] YouTube secondary width:", computedWidth);
    return computedWidth;
  }
  console.log(
    "[DEBUG] YouTube secondary element not found, using fallback width"
  );
  return "426px";
}

function monitorLayoutChanges() {
  // Watch for class and attribute changes on the watch element
  const layoutObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (
        mutation.type === "attributes" &&
        (mutation.attributeName === "theater" ||
          mutation.attributeName === "fullscreen")
      ) {
        console.log("[DEBUG] YouTube layout changed:", getYouTubeLayoutMode());

        if (sidebarVisible) {
          const currentMode = getYouTubeLayoutMode();
          if (currentMode !== "default") {
            toggleSidebar(false);
            return;
          }

          // Also update sidebar width if layout changes while sidebar is open
          const youtubeWidth = getYouTubeSecondaryWidth();
          if (sidebar) {
            const width =
              parseInt(youtubeWidth) +
              calculateAdditionalWidth(window.innerWidth);
            sidebar.style.width = width + "px";
          }
        }
      }
    }
  });

  // Observe ytd-watch-flexy for theater/fullscreen changes
  const watchElement = document.querySelector("ytd-watch-flexy");
  if (watchElement) {
    layoutObserver.observe(watchElement, { attributes: true });
    console.log("[DEBUG] Monitoring YouTube layout changes");
  }

  // Observe the player area for size changes
  const playerArea = document.querySelector("#player");
  if (playerArea) {
    layoutObserver.observe(playerArea, { attributes: true, subtree: true });
  }
}

// ===== SIDEBAR MANAGEMENT =====

function ensureSidebarExists() {
  if (!sidebar) {
    console.log("[DEBUG] Creating new sidebar element");
    sidebar = document.createElement("div");
    sidebar.id = "my-extension-sidebar";
    document.body.appendChild(sidebar);

    // Set up event delegation for close button
    document.addEventListener("click", (e) => {
      if (e.target && e.target.id === "sidebar-close") {
        console.log("[DEBUG] Close button clicked");
        toggleSidebar(false);
      }
    });

    console.log("[DEBUG] Sidebar element created and added to DOM");

    // Initial position sizing
    updateSidebarPosition(sidebar);

    // Handle window resize events
    window.addEventListener("resize", () => {
      if (sidebarVisible) {
        updateSidebarPosition(sidebar);
      }
    });
  }
  return sidebar;
}

function initializeSidebarContent(message = "Loading fact check...") {
  const sidebarEl = ensureSidebarExists();

  sidebarEl.innerHTML = `
    <button id="sidebar-close" aria-label="Close Sidebar">&times;</button>
    <h2>Fact Check</h2>
    <div id="fact-check-container">
      <div id="video-info">
        <div id="current-timestamp"></div>
      </div>
      <div id="fact-check-result" class="markdown-content">
        <div class="fact-status partial">Checking Facts...</div>
        <p>${message}</p>
      </div>
    </div>
  `;
}

function updateSidebarPosition(sidebarEl) {
  // Try multiple selector options for better reliability
  const selectors = [
    "#secondary",
    "ytd-watch-flexy #secondary",
    "#columns #secondary",
    "#columns .style-scope.ytd-watch-flexy#secondary",
  ];

  let secondary = null;
  // Try each selector until we find one that works
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element && element.offsetWidth > 0) {
      secondary = element;
      break;
    }
  }

  // If we found a valid secondary element
  if (secondary) {
    // Ensure the element is visible and rendered
    if (window.getComputedStyle(secondary).display === "none") {
      console.log("[DEBUG] Secondary element is hidden, using fallback");
      useFallbackDimensions(sidebarEl);
      return;
    }

    // Get the rect after ensuring visibility
    const secondaryRect = secondary.getBoundingClientRect();
    console.log("[DEBUG] Secondary element position:", secondaryRect);

    // If width is still 0, try to get width from computed style
    let sidebarWidth = secondaryRect.width;
    if (sidebarWidth === 0) {
      const computedStyle = window.getComputedStyle(secondary);
      const computedWidth = parseFloat(computedStyle.width);

      if (computedWidth > 0) {
        sidebarWidth = computedWidth;
        console.log("[DEBUG] Using computed width:", sidebarWidth);
      } else {
        // Try to measure offsetWidth as a last resort
        sidebarWidth = secondary.offsetWidth;
        console.log("[DEBUG] Using offsetWidth:", sidebarWidth);

        // If still zero, fall back to a default
        if (sidebarWidth === 0) {
          useFallbackDimensions(sidebarEl);
          return;
        }
      }
    }

    // Calculate additional width based on screen width
    const viewportWidth = window.innerWidth;
    const additionalWidth = calculateAdditionalWidth(viewportWidth);

    // Set sidebar width and position to match secondary element
    sidebarEl.style.width = `${sidebarWidth + additionalWidth}px`;

    // Calculate the right position when hidden (for animation)
    const hiddenRight = -(sidebarWidth + additionalWidth) - 32; // Width plus padding
    sidebarEl.style.right = `${hiddenRight}px`;

    console.log("[DEBUG] Set sidebar width to", sidebarWidth, "px");
  } else {
    useFallbackDimensions(sidebarEl);
  }
}

function useFallbackDimensions(sidebarEl) {
  // Responsive fallback based on screen width
  const viewportWidth = window.innerWidth;
  let fallbackWidth = 426; // Default fallback

  if (viewportWidth >= 1800) {
    fallbackWidth = 450;
  } else if (viewportWidth >= 1200) {
    fallbackWidth = 426;
  } else if (viewportWidth >= 1000) {
    fallbackWidth = 400;
  } else {
    fallbackWidth = 350;
  }

  sidebarEl.style.width = `${fallbackWidth}px`;
  sidebarEl.style.right = `-${fallbackWidth + 32}px`; // Width plus padding
  console.log("[DEBUG] Using fallback sidebar width:", fallbackWidth);
}

function calculateAdditionalWidth(screenWidth) {
  // For 1680px and below, return 0
  if (screenWidth <= 1680) {
    return 0;
  }
  // For 2560px and above, return 200
  if (screenWidth >= 2540) {
    return 200;
  }
  // For screens between 1680px and 1980px
  if (screenWidth <= 1980) {
    // Linear interpolation between (1680, 0) and (1980, 100)
    return ((screenWidth - 1680) / (1980 - 1680)) * 100;
  }
  // For screens between 1980px and 2560px
  // Linear interpolation between (1980, 100) and (2560, 200)
  return 100 + ((screenWidth - 1980) / (2560 - 1980)) * 100;
}

function toggleSidebar(show) {
  console.log("[DEBUG] Toggling sidebar, show:", show);

  const sidebarEl = ensureSidebarExists();

  if (show) {
    // Calculate sidebar position
    updateSidebarPosition(sidebarEl);

    // Check if we need to disable theater mode
    const currentLayout = getYouTubeLayoutMode();
    if (currentLayout === "theater") {
      disableTheaterMode();
      // Give time for theater mode to change before showing sidebar
      setTimeout(() => {
        showSidebar(sidebarEl);
      }, 300);
    } else {
      showSidebar(sidebarEl);
    }
  } else {
    hideSidebar(sidebarEl);
  }
}

function showSidebar(sidebarEl) {
  // First adjust the YouTube layout to prepare for sidebar
  adjustYouTubeLayout(true);

  // Short delay to ensure layout adjustment completes
  setTimeout(() => {
    // Make sidebar visible
    sidebarEl.classList.add("visible");
    sidebarVisible = true;

    console.log("[DEBUG] Sidebar now visible");
  }, 50);
}

function hideSidebar(sidebarEl) {
  // First hide the sidebar
  sidebarEl.classList.remove("visible");
  sidebarVisible = false;

  // Give animation time to complete before restoring layout
  setTimeout(() => {
    adjustYouTubeLayout(false);
    console.log("[DEBUG] Layout restored after sidebar hidden");
  }, 300); // Match transition time in CSS
}

// ===== TRANSCRIPT HANDLING =====

function getYouTubeTranscript() {
  console.log("[DEBUG] Getting transcript...");

  const transcriptContainer = document.querySelector(
    "ytd-transcript-segment-list-renderer"
  );
  if (!transcriptContainer) {
    console.warn("[DEBUG] Transcript container NOT found in DOM.");
    return "";
  }
  console.log("[DEBUG] Transcript container FOUND in DOM.");

  const segments = transcriptContainer.querySelectorAll(
    "ytd-transcript-segment-renderer"
  );
  console.log("[DEBUG] Found", segments.length, "transcript segments.");

  let transcriptText = "";
  segments.forEach((segment, index) => {
    const textEl = segment.querySelector("yt-formatted-string.segment-text");
    if (textEl) {
      transcriptText += textEl.innerText + " ";
    } else {
      console.warn(
        `[DEBUG] Segment #${index} missing .segment-text in <yt-formatted-string>.`
      );
    }
  });

  console.log("[DEBUG] Final transcript text length:", transcriptText.length);

  // Hide transcript after getting text
  const transcriptPanel = document.querySelector(
    "ytd-transcript-renderer, ytd-engagement-panel-section-list-renderer[data-panel-identifier='transcript']"
  );

  if (transcriptContainer) {
    transcriptContainer.style.display = "none";
  }

  if (transcriptPanel) {
    transcriptPanel.style.display = "none";
  }

  return transcriptText.trim();
}

async function clickMoreButton() {
  console.log("[DEBUG] clickMoreButton() called.");

  const moreButton = document.querySelector(
    "tp-yt-paper-button#expand.button.style-scope.ytd-text-inline-expander"
  );

  if (!moreButton) {
    console.warn("[DEBUG] Could not find the '...more' button (#expand).");
    return false;
  }

  moreButton.click();
  console.log("[DEBUG] Clicked the '...more' button.");

  await new Promise((resolve) => setTimeout(resolve, 800));
  return true;
}

async function clickShowTranscript() {
  console.log("[DEBUG] clickShowTranscript() called.");

  let transcriptBtn = document.querySelector(
    'tp-yt-paper-button[aria-label*="ranscript"], ytd-button-renderer[aria-label*="ranscript"]'
  );
  if (transcriptBtn) {
    transcriptBtn.click();
    console.log(
      "[DEBUG] Clicked 'Show transcript' button by aria-label match."
    );
    return true;
  }

  const possibleItems = document.querySelectorAll(
    'tp-yt-paper-button, ytd-menu-service-item-renderer, div[role="button"], button'
  );

  for (const item of possibleItems) {
    const text = (item.textContent || "").trim().toLowerCase();
    if (text.includes("transcript")) {
      item.click();
      console.log(
        "[DEBUG] Clicked item that contained the text 'transcript':",
        item
      );
      return true;
    }
  }

  const fillDiv = document.querySelector(".yt-spec-touch-feedback-shape__fill");
  if (fillDiv) {
    const parentButton = fillDiv.closest(
      "tp-yt-paper-button, button, div[role='button']"
    );
    if (parentButton) {
      parentButton.click();
      console.log(
        "[DEBUG] Clicked parent of .yt-spec-touch-feedback-shape__fill"
      );
      return true;
    }
  }

  console.warn("[DEBUG] 'Show transcript' button not found after expansion.");
  return false;
}

async function getTranscriptWithRetry(videoId, userApiKey) {
  console.log("[DEBUG] Attempting to auto-open the transcript...");

  // 1) Click the "more..." button
  const expanded = await clickMoreButton();
  if (!expanded) {
    console.warn(
      "[DEBUG] Could not click the '...more' button. Will continue anyway."
    );
  }

  // 2) Now try to find & click "Show transcript"
  const transcriptOpened = await clickShowTranscript();
  if (!transcriptOpened) {
    console.warn(
      "[DEBUG] Could not auto-open transcript. User may need to open manually."
    );
  }

  // 3) Wait a bit for transcript to load
  await new Promise((resolve) => setTimeout(resolve, 1200));

  // 4) Get the transcript
  const transcript = getYouTubeTranscript();
  console.log(
    "[DEBUG] Transcript length found:",
    transcript ? transcript.length : 0
  );

  if (!transcript || transcript.length === 0) {
    console.log(
      "[DEBUG] No transcript found on first attempt. Will retry after 4 seconds..."
    );

    // Show a waiting message in the sidebar
    initializeSidebarContent(
      "Waiting for YouTube to load transcript (retrying in 4 seconds)..."
    );

    // Wait 5 seconds and try again
    return new Promise((resolve) => {
      setTimeout(async () => {
        // Only proceed if the context is still active
        if (!isActive) {
          resolve("");
          return;
        }

        console.log(
          "[DEBUG] Retrying transcript retrieval after 5 second delay..."
        );

        // Try once more to click the buttons if needed
        await clickMoreButton();
        await clickShowTranscript();

        // Give some time for the transcript to load
        await new Promise((wait) => setTimeout(wait, 1200));

        // Retry getting the transcript
        const retryTranscript = getYouTubeTranscript();
        console.log(
          "[DEBUG] Retry transcript length found:",
          retryTranscript ? retryTranscript.length : 0
        );

        if (!retryTranscript || retryTranscript.length === 0) {
          console.warn("[DEBUG] No transcript available even after retry.");
          initializeSidebarContent(`
            <p>We couldn't automatically open the transcript after retrying. To fact-check this video, please open the transcript manually:</p>
            <ol>
              <li>Click <strong>more...</strong> under the video.</li>
              <li>Select <strong>Show transcript</strong>.</li>
              <li>Reopen this sidebar to see the results.</li>
            </ol>
          `);
          resolve("");
        } else {
          resolve(retryTranscript);
        }
      }, 4000); // 5 second delay for retry
    });
  }

  return transcript;
}
function getCurrentVideoTimeWindow() {
  const video = document.querySelector("video");
  if (!video) {
    console.warn("[DEBUG] No video element found");
    return null;
  }

  // Get current time in seconds
  const currentTime = video.currentTime;

  // Calculate start time (2 minutes before current position)
  const startTime = Math.max(0, currentTime - 120); // Don't go below 0

  return {
    startTime: startTime,
    endTime: currentTime,
    formattedStart: formatTimeStamp(startTime),
    formattedEnd: formatTimeStamp(currentTime),
  };
}

function formatTimeStamp(timeInSeconds) {
  const hours = Math.floor(timeInSeconds / 3600);
  const minutes = Math.floor((timeInSeconds % 3600) / 60);
  const seconds = Math.floor(timeInSeconds % 60);

  if (hours > 0) {
    return `${hours.toString().padStart(2, "0")}:${minutes
      .toString()
      .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  } else {
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }
}
function getYouTubeTranscriptSegment(startTimeSeconds, endTimeSeconds) {
  console.log(
    `[DEBUG] Getting transcript segment from ${startTimeSeconds}s to ${endTimeSeconds}s...`
  );

  const transcriptContainer = document.querySelector(
    "ytd-transcript-segment-list-renderer"
  );
  if (!transcriptContainer) {
    console.warn("[DEBUG] Transcript container NOT found in DOM.");
    return "";
  }
  console.log("[DEBUG] Transcript container FOUND in DOM.");

  const segments = transcriptContainer.querySelectorAll(
    "ytd-transcript-segment-renderer"
  );
  console.log("[DEBUG] Found", segments.length, "transcript segments.");

  let transcriptText = "";
  let segmentCount = 0;

  segments.forEach((segment) => {
    try {
      // Extract timestamp from the segment
      const timestampEl = segment.querySelector(".segment-timestamp");
      if (!timestampEl) {
        console.warn("[DEBUG] No timestamp element found in segment");
        return; // Skip if no timestamp found
      }

      // Convert timestamp (e.g., "0:01") to seconds
      const timestampText = timestampEl.textContent.trim();
      const segmentTimeInSeconds =
        convertYouTubeTimestampToSeconds(timestampText);

      // Check if this segment is within our time window
      if (
        segmentTimeInSeconds >= startTimeSeconds &&
        segmentTimeInSeconds <= endTimeSeconds
      ) {
        const textEl = segment.querySelector(
          "yt-formatted-string.segment-text"
        );
        if (textEl) {
          // Add timestamp to each segment for context
          transcriptText += `[${timestampText}] ${textEl.textContent.trim()} `;
          segmentCount++;
        } else {
          console.warn(
            "[DEBUG] No text element found for segment at timestamp",
            timestampText
          );
        }
      }
    } catch (error) {
      console.error("[DEBUG] Error processing transcript segment:", error);
    }
  });

  console.log(`[DEBUG] Found ${segmentCount} segments in the time window`);
  console.log("[DEBUG] Segment transcript text length:", transcriptText.length);

  return transcriptText.trim();
}
function convertYouTubeTimestampToSeconds(timestamp) {
  try {
    // Handle different formats: "0:01", "1:23", "12:34", "1:23:45"
    const parts = timestamp.split(":").map((part) => parseInt(part.trim(), 10));

    if (parts.length === 3) {
      // Hours:Minutes:Seconds format (e.g., "1:23:45")
      return parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      // Minutes:Seconds format (e.g., "1:23")
      return parts[0] * 60 + parts[1];
    } else if (parts.length === 1) {
      // Seconds only (e.g., "42")
      return parts[0];
    } else {
      console.warn("[DEBUG] Invalid timestamp format:", timestamp);
      return 0;
    }
  } catch (error) {
    console.error(
      "[DEBUG] Error converting timestamp:",
      error,
      "for timestamp:",
      timestamp
    );
    return 0;
  }
}
function getYouTubeTranscriptSegmentByTime(startTimeSeconds, endTimeSeconds) {
  // Try the timestamp-based method first
  const segmentByTimestamp = getYouTubeTranscriptSegment(
    startTimeSeconds,
    endTimeSeconds
  );

  if (segmentByTimestamp && segmentByTimestamp.length > 0) {
    return segmentByTimestamp;
  }

  console.log(
    "[DEBUG] Timestamp-based extraction failed. Trying alternate method..."
  );

  // Fallback: Get the full transcript and filter by estimated time windows
  const transcriptContainer = document.querySelector(
    "ytd-transcript-segment-list-renderer"
  );
  if (!transcriptContainer) {
    console.warn("[DEBUG] Transcript container NOT found in DOM.");
    return "";
  }

  // Get all segments
  const segments = Array.from(
    transcriptContainer.querySelectorAll("ytd-transcript-segment-renderer")
  );

  // If we can't find segments using the normal method, try a more general approach
  if (!segments || segments.length === 0) {
    console.warn(
      "[DEBUG] No transcript segments found with standard selector."
    );
    return getFullTranscriptAndApproximateSegment(
      startTimeSeconds,
      endTimeSeconds
    );
  }

  console.log("[DEBUG] Found", segments.length, "total transcript segments");

  // Find an approximate mapping of timestamps to positions in the transcript
  // First, collect all timestamps we can find
  const timestampMap = [];

  segments.forEach((segment, index) => {
    try {
      const timestampEl = segment.querySelector(".segment-timestamp");
      if (timestampEl) {
        const timestampText = timestampEl.textContent.trim();
        const timeInSeconds = convertYouTubeTimestampToSeconds(timestampText);
        timestampMap.push({
          index: index,
          time: timeInSeconds,
          text:
            segment
              .querySelector("yt-formatted-string.segment-text")
              ?.textContent.trim() || "",
        });
      }
    } catch (error) {
      // Skip problematic segments
    }
  });

  // Sort by time
  timestampMap.sort((a, b) => a.time - b.time);

  // Find start and end indices that cover our time window
  let startIndex = -1;
  let endIndex = -1;

  for (let i = 0; i < timestampMap.length; i++) {
    if (timestampMap[i].time >= startTimeSeconds && startIndex === -1) {
      startIndex = i;
    }
    if (timestampMap[i].time > endTimeSeconds && endIndex === -1) {
      endIndex = i;
      break;
    }
  }

  // If we couldn't find the end, use the last available segment
  if (endIndex === -1) {
    endIndex = timestampMap.length - 1;
  }

  // If we couldn't find the start, use the first segment
  if (startIndex === -1) {
    startIndex = 0;
  }

  // Extract the segment text
  let segmentText = "";
  for (let i = startIndex; i <= endIndex; i++) {
    segmentText += `[${formatTimeStamp(timestampMap[i].time)}] ${
      timestampMap[i].text
    } `;
  }

  console.log(
    `[DEBUG] Extracted ${
      endIndex - startIndex + 1
    } segments using fallback method`
  );

  return segmentText.trim();
}

// ===== CACHE MANAGEMENT =====

function cacheFactCheckResult(videoId, result, factStatus) {
  console.log("[DEBUG] Caching fact check result for video:", videoId);

  // Cache the result in memory
  factCheckCache[videoId] = {
    result: result,
    factStatus: factStatus,
    timestamp: Date.now(),
  };

  // Also store in extension storage for persistence across sessions
  try {
    chrome.storage.local.set(
      {
        [`factCheck_${videoId}`]: {
          result: result,
          factStatus: factStatus,
          timestamp: Date.now(),
        },
      },
      function () {
        console.log("[DEBUG] Fact check saved to persistent storage");
      }
    );
  } catch (error) {
    console.error("[DEBUG] Error saving to storage:", error);
  }
}

async function getCachedFactCheck(videoId) {
  console.log("[DEBUG] Checking for cached fact check for video:", videoId);

  // First check in-memory cache
  if (factCheckCache[videoId]) {
    console.log("[DEBUG] Found in-memory cache for video:", videoId);
    return factCheckCache[videoId];
  }

  // If not in memory, try loading from storage
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get([`factCheck_${videoId}`], function (result) {
        if (result[`factCheck_${videoId}`]) {
          console.log("[DEBUG] Found cached fact check in storage");
          // Store in memory cache for faster future access
          factCheckCache[videoId] = result[`factCheck_${videoId}`];
          resolve(result[`factCheck_${videoId}`]);
        } else {
          console.log("[DEBUG] No cached fact check found");
          resolve(null);
        }
      });
    } catch (error) {
      console.error("[DEBUG] Error accessing storage:", error);
      resolve(null);
    }
  });
}

function displayCachedFactCheck(cachedData) {
  const factCheckResultDiv = document.getElementById("fact-check-result");

  // Remove loading class
  factCheckResultDiv.classList.remove("loading");

  // Create status indicator based on cached status
  let statusHtml = "";
  if (cachedData.factStatus === "true") {
    statusHtml = '<div class="fact-status true">Factually Accurate</div>';
  } else if (cachedData.factStatus === "false") {
    statusHtml = '<div class="fact-status false">Factually Inaccurate</div>';
  } else {
    statusHtml = '<div class="fact-status partial">Partially Accurate</div>';
  }

  // Display the cached content with a note indicating it's from cache
  factCheckResultDiv.innerHTML =
    statusHtml +
    marked.parse(cachedData.result) +
    `<div class="cached-notice" style="margin-top: 15px; font-style: italic; font-size: 12px; opacity: 0.8;">
      Previously analysed on ${new Date(cachedData.timestamp).toLocaleString()}
    </div>`;

  // Add disclaimer section to sidebar
  addDisclaimerToSidebar();
}

function clearFactCheckCache() {
  // Clear in-memory cache
  Object.keys(factCheckCache).forEach((key) => {
    delete factCheckCache[key];
  });

  // Clear storage cache
  chrome.storage.local.get(null, function (items) {
    const keysToRemove = Object.keys(items).filter((key) =>
      key.startsWith("factCheck_")
    );
    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, function () {
        console.log(
          "[DEBUG] Cleared",
          keysToRemove.length,
          "cached fact checks from storage"
        );
      });
    }
  });
}

function manageCacheSize(maxEntries = 20) {
  chrome.storage.local.get(null, function (items) {
    const factCheckKeys = Object.keys(items).filter((key) =>
      key.startsWith("factCheck_")
    );

    if (factCheckKeys.length <= maxEntries) {
      return; // No need to clean up
    }

    // Convert to array of objects with timestamp
    const cacheEntries = factCheckKeys.map((key) => ({
      key: key,
      timestamp: items[key].timestamp || 0,
    }));

    // Sort by timestamp (oldest first)
    cacheEntries.sort((a, b) => a.timestamp - b.timestamp);

    // Remove oldest entries to get down to maxEntries
    const keysToRemove = cacheEntries
      .slice(0, cacheEntries.length - maxEntries)
      .map((entry) => entry.key);

    if (keysToRemove.length > 0) {
      chrome.storage.local.remove(keysToRemove, function () {
        console.log(
          "[DEBUG] Removed",
          keysToRemove.length,
          "oldest cache entries"
        );
      });
    }
  });
}

// ===== API AND FACT CHECKING =====

async function callGoogleGenAIStream(
  apiKey,
  transcript,
  userPrompt,
  onPartialUpdate
) {
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  const fullPrompt = `${userPrompt}\n\nTranscript:\n${transcript}`;

  const config = {
    model: "models/gemini-2.0-flash-exp",
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      responseModalities: "text",
    },
    tools: {
      functionDeclarations: [],
    },
  };

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let accumulatedText = ""; // Declare accumulator outside the onmessage handler.

    // Close WebSocket if the page unloads.
    window.addEventListener("beforeunload", () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    });

    ws.onopen = () => {
      console.log("WebSocket connection established.");
      ws.send(JSON.stringify({ setup: config }));
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      reject(error);
    };

    ws.onclose = (event) => {
      console.log("WebSocket connection closed:", event);
    };

    ws.onmessage = async (event) => {
      // Abort if the context is no longer active or if the document is hidden.
      if (!isActive || document.hidden) {
        ws.close();
        return;
      }
      try {
        const response = await blobToJSON(event.data);

        // When setup is complete, send the prompt.
        if (response.setupComplete !== undefined) {
          const clientMessage = {
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [{ text: fullPrompt }],
                },
              ],
              turnComplete: true,
            },
          };
          ws.send(JSON.stringify(clientMessage));
        }
        // Process streaming content updates.
        else if (response.serverContent) {
          const serverContent = response.serverContent;

          if (serverContent.interrupted) {
            console.warn("Server interrupted generation.");
            ws.close();
            reject(new Error("Server interrupted generation."));
            return;
          }

          if (
            serverContent.modelTurn &&
            Array.isArray(serverContent.modelTurn.parts)
          ) {
            // Append new text to the accumulator.
            serverContent.modelTurn.parts.forEach((part) => {
              if (part.text) {
                accumulatedText += part.text;
              }
            });
            // Update UI with the accumulated text.
            onPartialUpdate(accumulatedText, false); // false indicates this is not the final update
          }

          if (serverContent.turnComplete) {
            ws.close();
            // Call onPartialUpdate with the final flag set to true
            onPartialUpdate(accumulatedText, true); // true indicates this is the final update
            resolve(accumulatedText);
          }
        } else {
          console.log("Received an unrecognized message:", response);
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    };
  });
}

function determineFactStatus(text) {
  // First, check if we have a final verdict with the OVERALL ASSESSMENT
  const overallAssessmentMatch = text.match(
    /\*\*FINAL VERDICT\*\*.*?(?:"|'|)([^".]*?)(?:"|'|\.|$)/i
  );

  if (overallAssessmentMatch) {
    const assessment = overallAssessmentMatch[1].toLowerCase().trim();

    // Check for the specific phrases in the final verdict
    if (assessment.includes("factually accurate")) {
      return "true";
    } else if (assessment.includes("factually inaccurate")) {
      return "false";
    } else if (assessment.includes("partially accurate")) {
      return "partial";
    }
  }

  // If the text has "OVERALL ASSESSMENT" but we couldn't parse the specific verdict,
  // check for the exact phrases in the entire text
  if (text.includes("OVERALL ASSESSMENT")) {
    const finalParagraph = text.substring(text.indexOf("OVERALL ASSESSMENT"));

    if (finalParagraph.includes("Factually Accurate")) {
      return "true";
    } else if (finalParagraph.includes("Factually Inaccurate")) {
      return "false";
    } else if (finalParagraph.includes("Partially Accurate")) {
      return "partial";
    }
  }

  // Only fall back to keyword matching if we're still streaming and don't have
  // the final assessment yet
  if (!text.includes("OVERALL ASSESSMENT")) {
    // We should be more careful with these keywords to avoid false positives
    // Only check for these patterns in verdict sections

    // Extract all VERDICT sections from the text
    const verdictSections = text.match(/VERDICT:\s*(.*?)(?:\n|$)/g) || [];
    let trueCount = 0;
    let falseCount = 0;
    let partialCount = 0;

    verdictSections.forEach((verdict) => {
      const lowerVerdict = verdict.toLowerCase();
      if (lowerVerdict.includes("correct")) {
        trueCount++;
      } else if (
        lowerVerdict.includes("incorrect") ||
        lowerVerdict.includes("false") ||
        lowerVerdict.includes("misleading")
      ) {
        falseCount++;
      } else if (lowerVerdict.includes("partially")) {
        partialCount++;
      }
    });

    // If we have verdicts, use the majority rule
    if (verdictSections.length > 0) {
      if (trueCount > falseCount && trueCount > partialCount) {
        return "true";
      } else if (falseCount > trueCount && falseCount > partialCount) {
        return "false";
      } else {
        return "partial";
      }
    }

    // If we don't have any verdicts yet, return partial as default
    return "partial";
  }

  // Default to partial if nothing matched
  return "partial";
}

function addDisclaimerToSidebar() {
  if (!document.querySelector(".disclaimer-container")) {
    const disclaimerContainer = document.createElement("div");
    disclaimerContainer.className = "disclaimer-container";
    disclaimerContainer.style.marginTop = "20px";
    disclaimerContainer.style.padding = "12px";
    disclaimerContainer.style.borderRadius = "8px";
    disclaimerContainer.style.backgroundColor = "rgba(0, 0, 0, 0.2)";

    const disclaimerHeading = document.createElement("h4");
    disclaimerHeading.textContent = "Disclaimer";
    disclaimerHeading.style.margin = "0 0 8px 0";
    disclaimerHeading.style.fontSize = "14px";
    disclaimerContainer.appendChild(disclaimerHeading);

    const disclaimerText = document.createElement("div");
    disclaimerText.innerHTML =
      "The fact-check responses provided here are generated by an AI system. While we strive for accuracy, the AI may sometimes produce errors, outdated information, or incomplete analysis. Please verify with trusted sources before making decisions.";
    disclaimerText.style.fontSize = "12px";
    disclaimerText.style.lineHeight = "1.4";
    disclaimerContainer.appendChild(disclaimerText);

    sidebar.appendChild(disclaimerContainer);
  }
}

async function processFactCheck(transcript, userApiKey, videoId) {
  console.log(
    "[DEBUG] Processing fact check with transcript length:",
    transcript.length
  );

  // Initialize the enhanced sidebar with loading state
  sidebar.innerHTML = `
    <button id="sidebar-close" aria-label="Close Sidebar">&times;</button>
    <h2>Fact Check</h2>
    <div id="fact-check-container">
      <div id="video-info">
        <div id="current-timestamp"></div>
      </div>
      <div id="fact-check-result" class="markdown-content loading">
        <div class="fact-status partial">Analyzing Video...</div>
      </div>
    </div>
  `;

  const factCheckResultDiv = document.getElementById("fact-check-result");
  const userPrompt = `# FACT-CHECKING YOUTUBE VIDEOS

Analyze the transcript and proceed directly to examining the key factual claims without any explanatory introduction.

## FORMAT EACH CLAIM AS FOLLOWS:

### CLAIM #[number]: "[Direct quote]" [TIMESTAMP REQUIRED - HH:MM:SS or MM:SS format]

#### VERDICT:
- **Rating**: [Correct | Partially Correct | Incorrect | Misleading]
- **Explanation**: Provide a clear 2-3 sentence explanation of why this claim is true, false, or partially accurate, focusing on factual evidence.

#### EVIDENCE:
- Cite 2-3 relevant authoritative sources that verify or refute the claim
- Format each source as: "[Source name] ([Publication date]): [Brief description of relevant finding]"
- Prioritize academic research, official statistics, and recognized expert organizations
- Include accessible URLs where available

#### CONTEXT:
- Include essential missing context needed for full understanding
- If relevant, note any significant alternative perspective in 1-2 sentences
- For incorrect claims, provide the accurate information concisely

## OVERALL ASSESSMENT:

### SUMMARY:
- Provide a brief summary of the video's factual reliability (2-3 sentences)
- Note the proportion of accurate vs. inaccurate claims

### FINAL VERDICT: 
- **Rating**: [Factually Accurate | Partially Accurate | Factually Inaccurate]
- **Explanation**: [1-2 sentence justification for the rating]

### KEY SOURCES CONSULTED:
- List 3-5 main authoritative sources used across all claims
- Format as bullet points with full citations

## RESPONSE LENGTH GUIDELINES:
- Videos under 3 minutes: Analyze 1-2 main claims, response under 300 words
- Videos 3-10 minutes: Analyze 2-3 main claims, response under 500 words
- Videos over 10 minutes: Analyze maximum of 4 main claims, under 800 words
- Keep all explanations brief and evidence-focused

IMPORTANT: 
1. Begin your analysis immediately with the first claim
2. Every claim MUST include a timestamp in the format HH:MM:SS or MM:SS
3. Do not include any explanatory preamble or restate these instructions`;
  console.log(
    "[DEBUG] Sending transcript + prompt to callGoogleGenAIStream..."
  );

  let currentFactStatus = "partial"; // Default status

  // Callback to update the UI with each incoming chunk.
  const onPartialUpdate = (accumulatedText, isFinal = false) => {
    // Check if we're still in active fact-checking mode
    if (!factCheckingInProgress) {
      return; // Skip updates if fact-checking was cancelled or timed out
    }

    // Remove loading class once we start getting content
    factCheckResultDiv.classList.remove("loading");

    // For the final update, we definitely want to use the OVERALL ASSESSMENT
    // Otherwise, use our progressive determination logic
    if (isFinal) {
      currentFactStatus = determineFactStatus(accumulatedText);
    } else {
      currentFactStatus = determineFactStatus(accumulatedText);
    }

    // Create status indicator based on determined status
    let statusHtml = "";
    if (currentFactStatus === "true") {
      statusHtml = '<div class="fact-status true">Factually Accurate</div>';
    } else if (currentFactStatus === "false") {
      statusHtml = '<div class="fact-status false">Factually Inaccurate</div>';
    } else {
      statusHtml = '<div class="fact-status partial">Partially Accurate</div>';
    }

    // If this is the final update, reprocess the entire markdown for clean rendering
    if (isFinal) {
      console.log("[DEBUG] Final response received, refreshing markdown");
      factCheckResultDiv.innerHTML = statusHtml + marked.parse(accumulatedText);
    } else {
      // For streaming updates, render as we go
      factCheckResultDiv.innerHTML = statusHtml + marked.parse(accumulatedText);
    }
  };

  try {
    const finalText = await callGoogleGenAIStream(
      userApiKey,
      transcript,
      userPrompt,
      onPartialUpdate
    );
    console.log("[DEBUG] LLM call complete. Sidebar updated.");

    // Reset the fact checking status
    factCheckingInProgress = false;
    if (factCheckTimeoutId !== null) {
      clearTimeout(factCheckTimeoutId);
      factCheckTimeoutId = null;
    }

    if (finalText && finalText.length >= 200) {
      console.log("[DEBUG] Response length sufficient, caching result");
      cacheFactCheckResult(videoId, finalText, currentFactStatus);
    } else {
      console.warn(
        "[DEBUG] Response too short (length: " +
          (finalText ? finalText.length : 0) +
          "), not caching"
      );
    }

    // Add source citation section if not already present
    if (!document.querySelector(".source-citation")) {
      const sourceSection = document.createElement("div");
      sourceSection.className = "source-citation";
      sourceSection.innerHTML =
        "Analysis based on video transcript and available information as of the fact check time.";
      factCheckResultDiv.appendChild(sourceSection);
    }

    // Add disclaimer
    addDisclaimerToSidebar();
  } catch (error) {
    // Reset the fact checking status
    factCheckingInProgress = false;
    if (factCheckTimeoutId !== null) {
      clearTimeout(factCheckTimeoutId);
      factCheckTimeoutId = null;
    }

    factCheckResultDiv.innerHTML = `
      <div class="fact-status false">Error</div>
      <p>Error: ${error.message}</p>
      <p>Please try again or check your API key configuration.</p>
    `;
    console.error("[DEBUG] Error calling LLM:", error);
  }
}
async function processSegmentFactCheck(timeWindow, userApiKey, videoId) {
  console.log(
    `[DEBUG] Processing fact check for ${timeWindow.formattedStart} to ${timeWindow.formattedEnd}`
  );

  // Initialize the enhanced sidebar with loading state
  sidebar.innerHTML = `
    <button id="sidebar-close" aria-label="Close Sidebar">&times;</button>
    <h2>Segment Fact Check</h2>
    <div id="fact-check-container">
      <div id="video-info">
        <div id="current-timestamp">Segment: ${timeWindow.formattedStart} - ${timeWindow.formattedEnd}</div>
      </div>
      <div id="fact-check-result" class="markdown-content loading">
        <div class="fact-status partial">Analyzing Segment...</div>
      </div>
    </div>
  `;

  const factCheckResultDiv = document.getElementById("fact-check-result");

  // Get transcript with retry logic
  await clickMoreButton();
  await clickShowTranscript();

  // Wait a bit for transcript to load
  await new Promise((resolve) => setTimeout(resolve, 1500));

  // Try to get the transcript segment using our improved function
  const transcript = getYouTubeTranscriptSegmentByTime(
    timeWindow.startTime,
    timeWindow.endTime
  );

  if (!transcript || transcript.length === 0) {
    factCheckResultDiv.classList.remove("loading");
    factCheckResultDiv.innerHTML = `
      <div class="fact-status false">Error</div>
      <p>Couldn't find transcript segments for the time window ${timeWindow.formattedStart} - ${timeWindow.formattedEnd}.</p>
      <p>Make sure the transcript is available and try again.</p>
      <p>If this error persists, please try the full video fact check instead.</p>
    `;
    return;
  }

  // If the transcript is too short, it might be a parsing issue - try to get the full transcript as backup
  if (transcript.length < 50) {
    console.warn(
      "[DEBUG] Transcript segment is suspiciously short. Getting full transcript as backup."
    );
    const fullTranscript = getYouTubeTranscript();

    factCheckResultDiv.innerHTML = `
      <div class="fact-status partial">Limited Segment Data</div>
      <p>Limited transcript data found for the segment ${timeWindow.formattedStart} - ${timeWindow.formattedEnd}.</p>
      <p>Using available data for analysis, but results may be limited.</p>
    `;

    // If we have a full transcript, continue with the segment we found
    // If not, abort
    if (!fullTranscript || fullTranscript.length === 0) {
      factCheckResultDiv.classList.remove("loading");
      factCheckResultDiv.innerHTML = `
        <div class="fact-status false">Error</div>
        <p>Couldn't retrieve a usable transcript for this video.</p>
        <p>Please make sure captions/transcript is available for this video.</p>
      `;
      return;
    }
  }

  console.log(
    `[DEBUG] Using transcript segment with length: ${transcript.length}`
  );

  const userPrompt = `# FACT-CHECKING YOUTUBE VIDEO SEGMENT

Analyze this transcript segment from ${timeWindow.formattedStart} to ${timeWindow.formattedEnd} in the video.
Focus ONLY on claims made within this specific time segment.

## FORMAT EACH CLAIM AS FOLLOWS:

### CLAIM #[number]: "[Direct quote]" [TIMESTAMP]

#### VERDICT:
- **Rating**: [Correct | Partially Correct | Incorrect | Misleading]
- **Explanation**: Provide a clear 2-3 sentence explanation of why this claim is true, false, or partially accurate, focusing on factual evidence.

#### EVIDENCE:
- Cite 2-3 relevant authoritative sources that verify or refute the claim
- Format each source as: "[Source name] ([Publication date]): [Brief description of relevant finding]"

## OVERALL ASSESSMENT:

### SUMMARY:
- Provide a brief summary of this segment's factual reliability (2-3 sentences)

### FINAL VERDICT: 
- **Rating**: [Factually Accurate | Partially Accurate | Factually Inaccurate]
- **Explanation**: [1-2 sentence justification for the rating]

### KEY SOURCES CONSULTED:
- List 2-3 main authoritative sources used

IMPORTANT: 
1. Begin your analysis immediately with the first claim
2. Every claim MUST include a timestamp 
3. The segment is very short, so be concise and focus only on 1-2 main claims
4. If there are no factual claims in this segment, clearly state "No factual claims were identified in this segment" and provide a brief description of what was discussed instead`;

  // Define current fact status variable for the segment check
  let currentFactStatus = "partial"; // Default status

  // Define the callback to update the UI with each incoming chunk
  const onPartialUpdate = (accumulatedText, isFinal = false) => {
    // Check if we're still in active fact-checking mode
    if (!factCheckingInProgress) {
      return; // Skip updates if fact-checking was cancelled or timed out
    }

    // Remove loading class once we start getting content
    factCheckResultDiv.classList.remove("loading");

    // For the final update, we definitely want to use the OVERALL ASSESSMENT
    // Otherwise, use our progressive determination logic
    if (isFinal) {
      currentFactStatus = determineFactStatus(accumulatedText);
    } else {
      currentFactStatus = determineFactStatus(accumulatedText);
    }

    // Create status indicator based on determined status
    let statusHtml = "";
    if (currentFactStatus === "true") {
      statusHtml = '<div class="fact-status true">Factually Accurate</div>';
    } else if (currentFactStatus === "false") {
      statusHtml = '<div class="fact-status false">Factually Inaccurate</div>';
    } else {
      statusHtml = '<div class="fact-status partial">Partially Accurate</div>';
    }

    // If this is the final update, reprocess the entire markdown for clean rendering
    if (isFinal) {
      console.log(
        "[DEBUG] Final segment response received, refreshing markdown"
      );
      factCheckResultDiv.innerHTML = statusHtml + marked.parse(accumulatedText);
    } else {
      // For streaming updates, render as we go
      factCheckResultDiv.innerHTML = statusHtml + marked.parse(accumulatedText);
    }
  };

  try {
    const finalText = await callGoogleGenAIStream(
      userApiKey,
      transcript,
      userPrompt,
      onPartialUpdate
    );
    console.log("[DEBUG] LLM call complete. Sidebar updated.");

    // Reset the fact checking status
    factCheckingInProgress = false;
    if (factCheckTimeoutId !== null) {
      clearTimeout(factCheckTimeoutId);
      factCheckTimeoutId = null;
    }

    if (finalText && finalText.length >= 100) {
      console.log("[DEBUG] Response length sufficient, caching result");
      // Modify the cache key to include segment information
      const segmentCacheKey = `${videoId}_segment_${timeWindow.formattedStart}_${timeWindow.formattedEnd}`;
      cacheFactCheckResult(segmentCacheKey, finalText, currentFactStatus);
    } else {
      console.warn(
        "[DEBUG] Response too short (length: " +
          (finalText ? finalText.length : 0) +
          "), not caching"
      );
    }

    // Add source citation section if not already present
    if (!document.querySelector(".source-citation")) {
      const sourceSection = document.createElement("div");
      sourceSection.className = "source-citation";
      sourceSection.innerHTML =
        "Analysis based on video segment transcript from " +
        timeWindow.formattedStart +
        " to " +
        timeWindow.formattedEnd;
      factCheckResultDiv.appendChild(sourceSection);
    }

    // Add disclaimer
    addDisclaimerToSidebar();
  } catch (error) {
    // Reset the fact checking status
    factCheckingInProgress = false;
    if (factCheckTimeoutId !== null) {
      clearTimeout(factCheckTimeoutId);
      factCheckTimeoutId = null;
    }

    factCheckResultDiv.innerHTML = `
      <div class="fact-status false">Error</div>
      <p>Error: ${error.message}</p>
      <p>Please try again or check your API key configuration.</p>
    `;
    console.error("[DEBUG] Error calling LLM:", error);
  }
}

// ===== BUTTON INJECTION =====

function injectFactCheckButton() {
  console.log("[DEBUG] Injecting fact check button...");

  // If the button already exists, don't add another.
  if (document.querySelector(".my-custom-button")) {
    console.log("[DEBUG] Button already exists, not adding another one.");
    // Try to add the second button if the first one exists
    injectSecondButton();
    return true;
  }

  // Look for the control bar.
  const controlBar = document.querySelector(".ytp-left-controls");
  if (!controlBar) {
    console.log("[DEBUG] Control bar not found yet");
    buttonInjectionAttempts++;
    if (buttonInjectionAttempts >= MAX_INJECTION_ATTEMPTS) {
      console.warn(
        "[DEBUG] Max injection attempts reached. Giving up for now."
      );
      return false;
    }
    // Try again after a short delay.
    setTimeout(injectFactCheckButton, 500);
    return false;
  }

  console.log("[DEBUG] Control bar found. Inserting custom button...");
  try {
    // Create a container (flex) to host our custom buttons
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexGrow = "1"; // fill horizontal space
    container.style.justifyContent = "flex-end";
    container.style.alignItems = "center";
    container.className = "custom-buttons-container"; // Add class for easier selection

    // Create the custom button
    const button = document.createElement("button");
    button.className = "ytp-button my-custom-button";
    button.title = "Fact Check this Video";
    button.style.width = "30px";
    button.style.height = "30px";

    // Create an icon (PNG or SVG)
    const icon = document.createElement("img");
    icon.src = cachedIconUrl;
    icon.style.width = "100%";
    icon.style.height = "100%";
    icon.style.filter = "none"; // override YouTube invert if needed
    button.appendChild(icon);

    // Add a click event that toggles the sidebar + calls the AI
    button.addEventListener("click", async () => {
      console.log("[DEBUG] Custom button clicked. Toggling sidebar.");

      // If sidebar is visible, just hide it
      if (sidebarVisible) {
        toggleSidebar(false); // Hides sidebar

        // Cancel any ongoing fact check
        if (factCheckingInProgress) {
          factCheckingInProgress = false;
          if (factCheckTimeoutId !== null) {
            clearTimeout(factCheckTimeoutId);
            factCheckTimeoutId = null;
          }
        }
        return;
      }

      // If sidebar was hidden and we're showing it
      toggleSidebar(true); // Shows sidebar
      initializeSidebarContent("Loading...");

      // Get the current video ID
      const videoId = getYouTubeVideoId();
      if (!videoId) {
        console.warn("[DEBUG] Could not determine video ID");
        initializeSidebarContent("Error: Could not determine video ID.");
        return;
      }

      // Retrieve the saved API key and start fact-checking
      chrome.storage.sync.get("apiKey", async (data) => {
        if (!isActive) return; // Abort if the context is invalid
        const userApiKey = data.apiKey;
        console.log(
          "[DEBUG] Retrieved API key from storage:",
          userApiKey ? "(hidden)" : "None found"
        );

        if (!userApiKey) {
          initializeSidebarContent(
            '<span style="color:red;">No API key found. Please set it in the extension’s options.</span>'
          );
          return;
        }

        await handleFactCheck(videoId, userApiKey);
      });
    });

    // Add the container + button to the control bar
    container.appendChild(button);
    controlBar.appendChild(container);

    console.log("[DEBUG] Custom button and sidebar inserted!");

    // Now inject the second button
    setTimeout(() => {
      injectSecondButton();
    }, 500);

    return true;
  } catch (err) {
    console.error("[DEBUG] injectFactCheckButton error:", err);
    return false;
  }
}
function injectSecondButton() {
  console.log("[DEBUG] Injecting segment fact check button...");

  // If the second button already exists, don't add another.
  if (document.querySelector(".my-segment-button")) {
    console.log(
      "[DEBUG] Segment button already exists, not adding another one."
    );
    return true;
  }

  // Look for our first button's container
  const firstButtonContainer = document
    .querySelector(".my-custom-button")
    .closest("div");
  if (!firstButtonContainer) {
    console.log("[DEBUG] First button container not found yet");
    return false;
  }

  console.log("[DEBUG] First button found. Inserting segment button...");
  try {
    // Create the second button
    const button = document.createElement("button");
    button.className = "ytp-button my-segment-button";
    button.title = "Fact Check Last 2 Minutes";
    button.style.width = "30px";
    button.style.height = "30px";
    button.style.marginLeft = "8px"; // Add some spacing between buttons

    // Create an icon (using the same icon as the first button)
    const icon = document.createElement("img");
    icon.src = cachedIconUrl2;
    icon.style.width = "100%";
    icon.style.height = "100%";
    icon.style.filter = "none"; // override YouTube invert if needed
    button.appendChild(icon);

    // Add a click event listener for the segment check button
    button.addEventListener("click", async () => {
      console.log("[DEBUG] Segment fact check button clicked.");

      // If sidebar is visible, just hide it
      if (sidebarVisible) {
        toggleSidebar(false); // Hides sidebar

        // Cancel any ongoing fact check
        if (factCheckingInProgress) {
          factCheckingInProgress = false;
          if (factCheckTimeoutId !== null) {
            clearTimeout(factCheckTimeoutId);
            factCheckTimeoutId = null;
          }
        }
        return;
      }

      // Get the current time window
      const timeWindow = getCurrentVideoTimeWindow();
      if (!timeWindow) {
        console.warn("[DEBUG] Could not determine current video time");
        return;
      }

      // Get the current video ID
      const videoId = getYouTubeVideoId();
      if (!videoId) {
        console.warn("[DEBUG] Could not determine video ID");
        return;
      }

      // Show the sidebar with loading message
      toggleSidebar(true);
      initializeSidebarContent(
        `Loading fact check for segment ${timeWindow.formattedStart} - ${timeWindow.formattedEnd}...`
      );

      // Clear any existing timeout
      if (factCheckTimeoutId !== null) {
        clearTimeout(factCheckTimeoutId);
        factCheckTimeoutId = null;
      }

      // Set the fact checking status
      factCheckingInProgress = true;

      // Start a new timeout for this fact check attempt
      factCheckTimeoutId = setTimeout(() => {
        if (factCheckingInProgress) {
          console.log("[DEBUG] Segment fact check timeout reached.");
          factCheckingInProgress = false;
          factCheckTimeoutId = null;

          // Update sidebar with timeout message
          const factCheckResultDiv =
            document.getElementById("fact-check-result");
          if (factCheckResultDiv) {
            factCheckResultDiv.classList.remove("loading");
            factCheckResultDiv.innerHTML = `
              <div class="fact-status false">Timeout</div>
              <p>The segment fact check took too long to complete. Please try again.</p>
            `;
          }
        }
      }, FACT_CHECK_TIMEOUT);

      // Retrieve the saved API key and start fact-checking
      chrome.storage.sync.get("apiKey", async (data) => {
        if (!isActive) return; // Abort if the context is invalid
        const userApiKey = data.apiKey;

        if (!userApiKey) {
          initializeSidebarContent(
            '<span style="color:red;">No API key found. Please set it in the extension’s options.</span>'
          );
          return;
        }

        await processSegmentFactCheck(timeWindow, userApiKey, videoId);
      });
    });

    // Add the button to the container
    firstButtonContainer.appendChild(button);

    console.log("[DEBUG] Segment fact check button inserted!");
    return true;
  } catch (err) {
    console.error("[DEBUG] injectSecondButton error:", err);
    return false;
  }
}
// ===== INITIALIZATION =====

function setupNavigationDetection() {
  console.log("[DEBUG] Setting up enhanced navigation detection...");

  // Monitor YouTube layout changes for sidebar adjustments
  monitorLayoutChanges();

  // Standard YouTube navigation event listeners
  document.addEventListener("yt-navigate-start", () => {
    console.log("[DEBUG] yt-navigate-start event detected");
    isActive = false; // Cancel pending asynchronous tasks
    resetUI();
  });

  document.addEventListener("yt-navigate-finish", () => {
    console.log("[DEBUG] yt-navigate-finish event detected");
    isActive = true; // Reset cancellation flag for new page

    if (isVideoPage()) {
      setTimeout(injectFactCheckButton, 1000);
    }
  });

  document.addEventListener("yt-player-updated", () => {
    console.log("[DEBUG] yt-player-updated event detected");
    if (isVideoPage()) {
      injectFactCheckButton();
    }
  });

  // MutationObserver to detect video element
  const observer = new MutationObserver(() => {
    if (isVideoPage() && !document.querySelector(".my-custom-button")) {
      injectFactCheckButton();
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Polling fallback for button injection
  function checkForVideoAndInject() {
    if (isVideoPage()) {
      const videoElement = document.querySelector("video");
      const playerControls = document.querySelector(".ytp-left-controls");
      if (
        videoElement &&
        playerControls &&
        !document.querySelector(".my-custom-button")
      ) {
        console.log(
          "[DEBUG] Polling: Detected video and controls. Injecting button."
        );
        injectFactCheckButton();
      }
    }
    setTimeout(checkForVideoAndInject, 500);
  }
  checkForVideoAndInject();

  // Clean up older cache entries periodically
  manageCacheSize();

  // Initial injection attempt
  if (isVideoPage()) {
    setTimeout(injectFactCheckButton, 1000);
  }
}

// Start the extension
setupNavigationDetection();
