document.addEventListener("DOMContentLoaded", function () {
  // Get DOM elements
  const apiKeyInput = document.getElementById("apikey");
  const saveButton = document.getElementById("save");
  const getApiKeyButton = document.getElementById("getApiKey");
  const statusMessage = document.getElementById("status");

  // Optional elements - check if they exist before adding listeners
  const helpButton = document.getElementById("help");
  const aboutButton = document.getElementById("about");

  // Check if required elements exist
  if (!apiKeyInput || !saveButton || !getApiKeyButton || !statusMessage) {
    console.error("Required elements not found in popup.html");
    return;
  }

  // Load any previously saved API key and display it
  chrome.storage.sync.get("apiKey", function (data) {
    if (data.apiKey) {
      // Show a masked version of the API key for security
      const maskedKey = maskAPIKey(data.apiKey);
      apiKeyInput.value = maskedKey;
      apiKeyInput.dataset.original = data.apiKey;
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

      // Update the masked display
      const maskedKey = maskAPIKey(apiKey);
      apiKeyInput.value = maskedKey;
      apiKeyInput.dataset.original = apiKey;
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

  // Focus event - when user clicks on masked input, show empty field for new entry
  apiKeyInput.addEventListener("focus", function () {
    if (apiKeyInput.dataset.original) {
      apiKeyInput.value = "";
    }
  });

  // Blur event - when user leaves input without changing, show masked key again
  apiKeyInput.addEventListener("blur", function () {
    if (apiKeyInput.dataset.original && apiKeyInput.value === "") {
      apiKeyInput.value = maskAPIKey(apiKeyInput.dataset.original);
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
