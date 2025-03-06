// background.js - Create this file to handle the installation event
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    // Open the guide.html page when the extension is first installed
    chrome.tabs.create({
      url: chrome.runtime.getURL("guide.html"),
    });

    // Set a flag in storage indicating that the guide has been shown
    chrome.storage.local.set({ guideShown: true });
  } else if (details.reason === "update") {
    // Optional: Open a different page for updates
    // chrome.tabs.create({
    //   url: chrome.runtime.getURL("update.html")
    // });
  }
});
