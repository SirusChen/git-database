const statusEl = document.getElementById("status");
const tabIdEl = document.getElementById("tabId");
const app = document.getElementById("app");

// 从 URL 参数中获取 tabId
const params = new URLSearchParams(window.location.search);
const tabId = params.get("tabId");

if (tabId) {
  if (tabIdEl) {
    tabIdEl.textContent = `Tab ID: ${tabId}`;
    tabIdEl.style.fontWeight = "bold";
    tabIdEl.style.color = "#0066cc";
    tabIdEl.style.padding = "8px";
    tabIdEl.style.borderBottom = "1px solid #ccc";
  }
  
  if (statusEl) {
    statusEl.textContent = `Connected to tab ${tabId}`;
    statusEl.style.color = "green";
  }
} else {
  if (tabIdEl) {
    tabIdEl.textContent = "Tab ID: Not found";
    tabIdEl.style.color = "red";
  }
  
  if (statusEl) {
    statusEl.textContent = "Missing tabId parameter";
    statusEl.style.color = "red";
  }
}

if (app) {
  app.textContent = "Hello World";
}
