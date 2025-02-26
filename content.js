/********************************
 * 1) CACHE ICON URL AT THE TOP *
 ********************************/
/* chrome.runtime.onInstalled.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") });
}); */
let cachedIconUrl;
try {
  // If this fails due to extension context problems,
  // we either catch it or supply a fallback
  cachedIconUrl = chrome.runtime.getURL("icons/my-icon.png");
} catch (error) {
  console.error("[DEBUG] Could not get icon URL:", error);
  // Fallback to some data URI or a blank icon
  cachedIconUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAU..."; // etc.
}
// Global cancellation flag to track active context
let isActive = true;
// Cache object to store fact-check results by videoId
const factCheckCache = {};
// Global variables and utility functions remain the same
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
// Helper function to extract YouTube video ID from URL
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

function getYouTubeTranscript() {
  console.log("[DEBUG] getYouTubeTranscript() called.");

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
  return transcriptText.trim();
}

// Updated callGoogleGenAIStream function that correctly accumulates text.
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

// Define the sidebar and its state globally.
let sidebar;
let sidebarVisible = false;
// Initialize sidebar if it doesn't exist
function ensureSidebarExists() {
  if (!sidebar) {
    sidebar = document.createElement("div");
    sidebar.id = "my-extension-sidebar";
    document.body.appendChild(sidebar);

    // Set up event delegation for close button
    document.addEventListener("click", (e) => {
      if (e.target && e.target.id === "sidebar-close") {
        toggleSidebar(false);
      }
    });
  }
  return sidebar;
}

// Enhanced sidebar initialization with updated UI
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

// Analyze content to determine fact-check status
function determineFactStatus(text) {
  const lowerText = text.toLowerCase();

  // Simple heuristic - can be improved with more sophisticated analysis
  if (
    lowerText.includes("false claim") ||
    lowerText.includes("inaccurate") ||
    lowerText.includes("misleading") ||
    lowerText.includes("not supported")
  ) {
    return "false";
  } else if (
    lowerText.includes("partially accurate") ||
    lowerText.includes("mixture") ||
    lowerText.includes("some accuracy") ||
    lowerText.includes("partially true")
  ) {
    return "partial";
  } else if (
    lowerText.includes("accurate") ||
    lowerText.includes("factual") ||
    lowerText.includes("true claim") ||
    lowerText.includes("supported by evidence")
  ) {
    return "true";
  }

  return "partial"; // Default to partial if can't determine
}

// Utility function to toggle visibility (using a CSS class).
function toggleSidebar(show) {
  const sidebarEl = ensureSidebarExists();
  sidebarEl.classList.toggle("visible", show);
  sidebarVisible = show;

  // If showing the sidebar, start timestamp updates
}

// Instead of relying solely on window.location, we check for the presence of a <video> element.
function isVideoPage() {
  return !!document.querySelector("video");
}

// Reset function: clears any injected button and sidebar.
function resetUI() {
  console.log("[DEBUG] Resetting UI state...");
  buttonInjectionAttempts = 0;

  // Hide sidebar if it's visible.
  if (sidebarVisible) {
    toggleSidebar(false);
  }

  // Remove any existing button to prevent duplicates.
  const existingButton = document.querySelector(".my-custom-button");
  if (existingButton) {
    existingButton.parentElement.remove();
    console.log("[DEBUG] Removed existing button");
  }
}
// Save fact check result to cache
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

// Retrieve fact check result from cache
function getCachedFactCheck(videoId) {
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

// Display cached fact check content in sidebar
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
      Previously analyzed on ${new Date(cachedData.timestamp).toLocaleString()}
     </div>`;
}
function injectFactCheckButton() {
  console.log("[DEBUG] Injecting fact check button...");

  // If the button already exists, don’t add another.
  if (document.querySelector(".my-custom-button")) {
    console.log("[DEBUG] Button already exists, not adding another one.");
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
    // Create a container (flex) to host our custom button
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexGrow = "1"; // fill horizontal space
    container.style.justifyContent = "flex-end";
    container.style.alignItems = "center";

    // Create the custom button
    const button = document.createElement("button");
    button.className = "ytp-button my-custom-button";
    button.title = "Fact Check this Video";
    button.style.width = "36px";
    button.style.height = "36px";

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

      // If we just opened the sidebar, call the AI
      if (!sidebarVisible) {
        toggleSidebar(true); // Shows sidebar by adding the "visible" class.
        initializeSidebarContent("Loading...");
        // Get the current video ID
        const videoId = getYouTubeVideoId();
        if (!videoId) {
          console.warn("[DEBUG] Could not determine video ID");
          initializeSidebarContent("Error: Could not determine video ID.");
          return;
        }

        // Check if we have a cached result
        const cachedResult = await getCachedFactCheck(videoId);

        if (cachedResult) {
          console.log("[DEBUG] Using cached fact check result");
          displayCachedFactCheck(cachedResult);
          return;
        }
        // Retrieve the saved API key
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
          // Get the transcript
          const transcript = getYouTubeTranscript();
          console.log("[DEBUG] Transcript length found:", transcript.length);

          if (!transcript) {
            console.warn(
              "[DEBUG] No transcript available. Showing message in sidebar."
            );
            initializeSidebarContent(`
        <p>We couldn't automatically open the transcript. To fact-check this video, please open the transcript manually:</p>
        <ol>
          <li>Click <strong>more...</strong> under the video.</li>
          <li>Select <strong>Show transcript</strong>.</li>
          <li>Reopen this sidebar to see the results.</li>
        </ol>
      `);
            return;
          }

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

          const factCheckResultDiv =
            document.getElementById("fact-check-result");
          // Call the LLM using the streaming function
          const userPrompt = `IDENTIFY KEY CLAIMS:
- Analyze the entire transcript to identify the most significant factual claims
- Focus on claims that are central to the video's main argument or repeated frequently
- Prioritize claims that could potentially misinform viewers if inaccurate
- Distinguish between factual assertions, opinions, and speculative statements

FORMAT BY CLAIM:
For each major claim identified, create a separate section with the following structure:

CLAIM #[number]: "[Direct quote with timestamp]"

  CREDIBILITY:
  - Assess accuracy based on current consensus knowledge
  - Rate reliability: Confirmed, Likely True, Uncertain, Likely False, Demonstrably False
  - Identify logical fallacies or misleading rhetorical techniques if present
  
  CONTEXT:
  - Provide alternative perspectives on controversial topics
  - Present relevant information that may have been omitted
  - Explain broader context necessary for accurate understanding
  - For uncertain/questionable claims only, recommend specific credible sources
  
OVERALL ASSESSMENT:
- Provide a balanced summary of the video's factual reliability
- Highlight the most significant factual issues identified
- Summarize key alternative viewpoints viewers should consider

RESPONSE LENGTH GUIDELINES (internal use only):
- Videos under 3 minutes: Focus on 1 main claim, response under 400 words
- Videos 3-10 minutes: Focus on 2-3 main claims, response under 800 words
- Videos over 10 minutes: Focus on maximum of 5 main claims

Maintain neutrality and avoid political bias. Your goal is to help viewers make informed judgments, not promote any particular viewpoint.`;
          console.log(
            "[DEBUG] Sending transcript + prompt to callGoogleGenAIStream..."
          );

          let currentFactStatus = "partial"; // Default status

          // Callback to update the UI with each incoming chunk.
          const onPartialUpdate = (accumulatedText, isFinal = false) => {
            // Remove loading class once we start getting content
            factCheckResultDiv.classList.remove("loading");

            // Determine fact status based on content
            currentFactStatus = determineFactStatus(accumulatedText);

            // Create status indicator based on determined status
            let statusHtml = "";
            if (currentFactStatus === "true") {
              statusHtml =
                '<div class="fact-status true">Factually Accurate</div>';
            } else if (currentFactStatus === "false") {
              statusHtml =
                '<div class="fact-status false">Factually Inaccurate</div>';
            } else {
              statusHtml =
                '<div class="fact-status partial">Partially Accurate</div>';
            }

            // If this is the final update, reprocess the entire markdown for clean rendering
            if (isFinal) {
              console.log(
                "[DEBUG] Final response received, refreshing markdown"
              );
              factCheckResultDiv.innerHTML =
                statusHtml + marked.parse(accumulatedText);
            } else {
              // For streaming updates, render as we go
              factCheckResultDiv.innerHTML =
                statusHtml + marked.parse(accumulatedText);
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

            // Add disclaimer section
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
          } catch (error) {
            factCheckResultDiv.innerHTML = `
              <div class="fact-status false">Error</div>
              <p>Error: ${error.message}</p>
              <p>Please try again or check your API key configuration.</p>
            `;
            console.error("[DEBUG] Error calling LLM:", error);
          }
        });
      } else {
        toggleSidebar(false); // Hides sidebar.
      }
    });

    // Add the container + button to the control bar
    container.appendChild(button);
    controlBar.appendChild(container);

    console.log("[DEBUG] Custom button and sidebar inserted!");
    return true;
  } catch (err) {
    console.error("[DEBUG] injectFactCheckButton error:", err);
    return false;
  }
}
// Add function to clear cache
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

// Add function to manage cache size
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
let buttonInjectionAttempts = 0;
const MAX_INJECTION_ATTEMPTS = 10;

function setupNavigationDetection() {
  console.log("[DEBUG] Setting up enhanced navigation detection...");

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

  // MutationObserver approach
  const observer = new MutationObserver(() => {
    if (isVideoPage()) {
      const videoElement = document.querySelector("video");
      if (videoElement && !document.querySelector(".my-custom-button")) {
        console.log("[DEBUG] MutationObserver: Video element detected.");
        injectFactCheckButton();
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  // Polling fallback
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

// Finally, start navigation detection
setupNavigationDetection();
