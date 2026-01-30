(function injectLogger() {
  const levels = ["log", "info", "warn", "error", "debug"];

  const logger = {};

  levels.forEach((level) => {
    logger[level] = (...args) => {
      console[level](...args);
    };
  });

  function setLogger() {
    try {
      Object.defineProperty(window, "logger", {
        value: logger,
        writable: false,
        configurable: false,
        enumerable: true,
      });
      
      if (window.logger && typeof window.logger.log === "function") {
        return true;
      }
    } catch (e) {}
    
    try {
      window.logger = logger;
      if (window.logger && typeof window.logger.log === "function") {
        return true;
      }
    } catch (e) {}
    
    return false;
  }

  if (setLogger()) {
    window.__LOGGER_INJECTED__ = true;
    
    window.addEventListener("beforeunload", () => {
      window.__LOGGER_INJECTED__ = false;
    });
    
    const checkInterval = setInterval(() => {
      if (!window.logger || typeof window.logger.log !== "function") {
        setLogger();
      }
    }, 1000);
    
    window.addEventListener("beforeunload", () => {
      clearInterval(checkInterval);
    });
  } else {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => {
        setTimeout(() => {
          if (!window.logger) {
            setLogger();
          }
        }, 100);
      });
    } else {
      setTimeout(() => {
        if (!window.logger) {
          setLogger();
        }
      }, 100);
    }
  }
})();
