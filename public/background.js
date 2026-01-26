// 注入 logger 到指定标签页
async function injectLogger(tabId, reason = "unknown") {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab.url) return;
    
    // 跳过 chrome:// 等特殊页面
    if (tab.url.startsWith("chrome://") || tab.url.startsWith("edge://") || tab.url.startsWith("about:")) {
      return;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["injected.js"],
    });
    console.log(`✓ Logger injected into tab ${tabId} (${reason})`);
  } catch (err) {
    console.error(`Failed to inject logger into tab ${tabId}:`, err.message);
  }
}

// 扩展安装或启动时，为所有已打开的标签页注入 logger
chrome.runtime.onInstalled.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      await injectLogger(tab.id, "onInstalled");
    }
  }
});

// 扩展启动时，为所有已打开的标签页注入 logger
chrome.runtime.onStartup.addListener(async () => {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      await injectLogger(tab.id, "onStartup");
    }
  }
});

// 监听标签页更新，注入 logger 脚本到页面上下文
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab.url) return;
  
  // 在页面加载时和加载完成后都尝试注入
  if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    await injectLogger(tabId, `status: ${changeInfo.status}`);
  }
});
