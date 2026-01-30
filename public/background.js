async function injectLogger(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["injected.js"],
      world: "MAIN",
    });
  } catch (err) {
    // 忽略注入失败
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      await injectLogger(tab.id);
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      await injectLogger(tab.id);
    }
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url) return;
  
  if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    await injectLogger(tabId);
  }
});
