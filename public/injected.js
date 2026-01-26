(() => {
  // 防止重复注入
  if (window.__LOGGER_INJECTED__) {
    console.warn("Logger already injected, skipping...");
    return;
  }

  const levels = ["log", "info", "warn", "error", "debug"];

  const logger = {};

  levels.forEach((level) => {
    logger[level] = (...args) => {
      // 简单实现：直接调用原生 console
      console[level](...args);
    };
  });

  Object.defineProperty(window, "logger", {
    value: logger,
    writable: false,
    configurable: false,
  });

  window.__LOGGER_INJECTED__ = true;

  console.log("%c✓ Logger injected successfully!", "color: green; font-weight: bold;", Object.keys(logger));
  console.log("Try: logger.log('Hello World!')");
})();
