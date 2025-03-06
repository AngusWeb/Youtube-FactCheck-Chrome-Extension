document.addEventListener("DOMContentLoaded", function () {
  // Get DOM elements
  const apiKeyInput = document.getElementById("apikey");
  const saveButton = document.getElementById("save");
  const getApiKeyButton = document.getElementById("getApiKey");
  const statusMessage = document.getElementById("status");
  const pasteButton = document.getElementById("paste-button");

  // Optional elements - check if they exist before adding listeners
  const helpButton = document.getElementById("help");
  const aboutButton = document.getElementById("about");

  // Check if required elements exist
  if (
    !apiKeyInput ||
    !saveButton ||
    !getApiKeyButton ||
    !statusMessage ||
    !pasteButton
  ) {
    console.error("Required elements not found in popup.html");
    return;
  }

  // Load any previously saved API key
  chrome.storage.sync.get("apiKey", function (data) {
    if (data.apiKey) {
      // Don't display the masked key, leave field empty and update placeholder
      apiKeyInput.value = "";
      apiKeyInput.dataset.original = data.apiKey;
      // Change placeholder to indicate API is stored
      apiKeyInput.placeholder = "API ALREADY STORED";
    }
  });

  // Save button click event
  saveButton.addEventListener("click", function () {
    // Get the original API key if it was masked, otherwise use the input value
    const apiKey = apiKeyInput.dataset.original || apiKeyInput.value.trim();

    if (!apiKey) {
      showStatus("Please enter an API key", "error");
      return;
    }

    // Store the API key
    chrome.storage.sync.set({ apiKey: apiKey }, function () {
      // Show success message
      showStatus("API key saved successfully!", "success");

      // Clear input field and update placeholder
      apiKeyInput.value = "";
      apiKeyInput.dataset.original = apiKey;
      // Update placeholder
      apiKeyInput.placeholder = "API ALREADY STORED";
    });
  });

  // Paste button click event
  pasteButton.addEventListener("click", function () {
    // Use clipboard API to paste text
    navigator.clipboard
      .readText()
      .then((text) => {
        apiKeyInput.value = text.trim();
        apiKeyInput.dataset.original = ""; // Clear the original value to treat this as a new input
        apiKeyInput.focus();
      })
      .catch((err) => {
        showStatus("Unable to paste from clipboard", "error");
        console.error("Failed to read clipboard: ", err);
      });
  });

  // Get API Key button click event
  getApiKeyButton.addEventListener("click", function () {
    // Open a new tab with instructions on how to get a free API key
    chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") });
  });

  // Only add event listeners to optional elements if they exist
  if (helpButton) {
    helpButton.addEventListener("click", function () {
      chrome.tabs.create({ url: "https://yourdocumentation.com/help" });
    });
  }

  if (aboutButton) {
    aboutButton.addEventListener("click", function () {
      chrome.tabs.create({ url: "https://yourdocumentation.com/about" });
    });
  }

  // Focus event - no need to change anything now since field is already empty
  apiKeyInput.addEventListener("focus", function () {
    // Field is already empty, no need to clear it
  });

  // Blur event - keep field empty when losing focus to show placeholder
  apiKeyInput.addEventListener("blur", function () {
    if (apiKeyInput.dataset.original && apiKeyInput.value === "") {
      // Keep the field empty to show the placeholder
    }
  });

  // Helper function to mask API key for display
  function maskAPIKey(key) {
    if (!key) return "";

    // Show only first 4 and last 4 characters
    if (key.length <= 8) {
      return "•".repeat(key.length);
    }

    return (
      key.substring(0, 4) +
      "•".repeat(key.length - 8) +
      key.substring(key.length - 4)
    );
  }

  // Helper function to show status message
  function showStatus(message, type = "success") {
    statusMessage.textContent = message;
    statusMessage.style.color = type === "success" ? "#28a745" : "#dc3545";

    // Clear message after 3 seconds
    setTimeout(() => {
      statusMessage.textContent = "";
    }, 3000);
  }
});
const buyMeCoffeeButton = document.getElementById("buyMeCoffee");
if (buyMeCoffeeButton) {
  buyMeCoffeeButton.addEventListener("click", function () {
    // Replace with your actual Buy Me a Coffee username
    chrome.tabs.create({ url: "https://buymeacoffee.com/angusdev" });
  });
}
