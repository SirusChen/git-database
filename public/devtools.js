const tabId = chrome.devtools.inspectedWindow.tabId;

chrome.devtools.panels.create(
  "Console+",
  null,
  `panel.html?tabId=${tabId}`,
  (panel) => {
    console.log("Panel created for tab:", tabId);
  }
);
