(() => {
  if (globalThis.__nightDimmerV3Loaded) {
    return;
  }

  globalThis.__nightDimmerV3Loaded = true;

  const DIMMER_ID = "night-dimmer-v3-dimmer";
  const COMFORT_ID = "night-dimmer-v3-comfort";
  const STYLE_ID = "night-dimmer-v3-dark-styles";
  const ROOT_CLASS = "night-dimmer-v3-root";
  const BG_CLASS = "night-dimmer-v3-bg";
  const TEXT_CLASS = "night-dimmer-v3-text";
  const BORDER_CLASS = "night-dimmer-v3-border";
  const TOP_FRAME = window === window.top;

  const DARK_PALETTES = {
    soft: {
      root: "#25282d",
      backgroundBase: 0.15,
      backgroundRange: 0.1,
      textBase: 0.8,
      textRange: 0.1,
      border: "#50545b",
    },
    balanced: {
      root: "#17191d",
      backgroundBase: 0.09,
      backgroundRange: 0.08,
      textBase: 0.85,
      textRange: 0.09,
      border: "#3e4249",
    },
    intense: {
      root: "#0d0f12",
      backgroundBase: 0.04,
      backgroundRange: 0.06,
      textBase: 0.9,
      textRange: 0.07,
      border: "#34383e",
    },
  };

  const styledElements = new Set();
  const injectedStyles = new Set();
  const preparedRoots = new Set();
  const observers = [];
  let elementQueue = [];
  let queueScheduled = false;
  let darkModeEnabled = false;
  let darkModeLevel = "balanced";
  let generation = 0;

  function setImportantStyles(element, styles) {
    for (const [property, value] of Object.entries(styles)) {
      element.style.setProperty(property, value, "important");
    }
  }

  function getOrCreateOverlay(id, extraStyles = {}) {
    let overlay = document.getElementById(id);

    if (overlay) {
      return overlay;
    }

    if (!document.documentElement) {
      return null;
    }

    overlay = document.createElement("div");
    overlay.id = id;
    overlay.setAttribute("aria-hidden", "true");

    setImportantStyles(overlay, {
      position: "fixed",
      inset: "0",
      width: "100vw",
      height: "100vh",
      margin: "0",
      padding: "0",
      border: "0",
      "pointer-events": "none",
      "z-index": "2147483647",
      opacity: "0",
      visibility: "hidden",
      transition: "opacity 120ms ease",
      ...extraStyles,
    });

    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function parseColor(color) {
    if (!color || color === "transparent") {
      return null;
    }

    const values = color.match(/[\d.]+/g)?.map(Number);
    if (!values || values.length < 3) {
      return null;
    }

    return {
      red: values[0],
      green: values[1],
      blue: values[2],
      alpha: values.length > 3 ? values[3] : 1,
    };
  }

  function rgbToHsl({ red, green, blue }) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const lightness = (maximum + minimum) / 2;

    if (maximum === minimum) {
      return { hue: 0, saturation: 0, lightness };
    }

    const difference = maximum - minimum;
    const saturation =
      lightness > 0.5
        ? difference / (2 - maximum - minimum)
        : difference / (maximum + minimum);
    let hue;

    if (maximum === r) {
      hue = (g - b) / difference + (g < b ? 6 : 0);
    } else if (maximum === g) {
      hue = (b - r) / difference + 2;
    } else {
      hue = (r - g) / difference + 4;
    }

    return { hue: hue * 60, saturation, lightness };
  }

  function toHslColor(hue, saturation, lightness, alpha = 1) {
    const h = Math.round(hue);
    const s = Math.round(saturation * 100);
    const l = Math.round(lightness * 100);
    return `hsl(${h} ${s}% ${l}% / ${alpha})`;
  }

  function isLight(color) {
    return color && color.alpha > 0.05 && rgbToHsl(color).lightness > 0.58;
  }

  function hasOriginallyLightBackdrop(element) {
    let current = element;

    while (current) {
      if (current.classList?.contains(BG_CLASS)) {
        return true;
      }

      const background = parseColor(getComputedStyle(current).backgroundColor);
      if (background && background.alpha > 0.05) {
        return isLight(background);
      }

      current = current.parentElement;
    }

    return true;
  }

  function ensureDarkStyles(root) {
    if (root.querySelector?.(`#${STYLE_ID}`)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.${ROOT_CLASS} {
        color-scheme: dark !important;
        background-color: var(--night-dimmer-v3-root-bg) !important;
      }
      .${BG_CLASS} {
        background-color: var(--night-dimmer-v3-bg) !important;
      }
      .${TEXT_CLASS} {
        color: var(--night-dimmer-v3-text) !important;
      }
      .${BORDER_CLASS} {
        border-color: var(--night-dimmer-v3-border) !important;
        outline-color: var(--night-dimmer-v3-border) !important;
      }
    `;

    if (root instanceof ShadowRoot) {
      root.appendChild(style);
    } else {
      document.documentElement.appendChild(style);
    }

    injectedStyles.add(style);
  }

  function processElement(element, palette) {
    if (!(element instanceof Element)) {
      return;
    }

    if (
      element.id?.startsWith("night-dimmer-v3-") ||
      ["SCRIPT", "STYLE", "LINK", "META", "NOSCRIPT"].includes(element.tagName) ||
      element.namespaceURI === "http://www.w3.org/2000/svg"
    ) {
      return;
    }

    const computed = getComputedStyle(element);
    const background = parseColor(computed.backgroundColor);
    const foreground = parseColor(computed.color);
    const backgroundIsLight = isLight(background);
    const mediaElement = [
      "IMG",
      "VIDEO",
      "CANVAS",
      "PICTURE",
      "IFRAME",
      "OBJECT",
      "EMBED",
    ].includes(element.tagName);

    if (
      backgroundIsLight &&
      !mediaElement &&
      computed.backgroundImage === "none"
    ) {
      const hsl = rgbToHsl(background);
      const darkLightness =
        palette.backgroundBase + (1 - hsl.lightness) * palette.backgroundRange;
      element.style.setProperty(
        "--night-dimmer-v3-bg",
        toHslColor(hsl.hue, Math.min(hsl.saturation, 0.35), darkLightness),
      );
      element.classList.add(BG_CLASS);
      styledElements.add(element);
    }

    if (
      foreground &&
      foreground.alpha > 0.05 &&
      rgbToHsl(foreground).lightness < 0.56 &&
      (backgroundIsLight || hasOriginallyLightBackdrop(element.parentElement))
    ) {
      const hsl = rgbToHsl(foreground);
      const lightness = Math.min(
        0.97,
        palette.textBase + (0.56 - hsl.lightness) * palette.textRange,
      );
      element.style.setProperty(
        "--night-dimmer-v3-text",
        toHslColor(hsl.hue, Math.min(hsl.saturation, 0.55), lightness),
      );
      element.classList.add(TEXT_CLASS);
      styledElements.add(element);
    }

    const border = parseColor(computed.borderTopColor);
    const hasBorder =
      parseFloat(computed.borderTopWidth) > 0 ||
      parseFloat(computed.borderRightWidth) > 0 ||
      parseFloat(computed.borderBottomWidth) > 0 ||
      parseFloat(computed.borderLeftWidth) > 0;

    if (border && border.alpha > 0.05 && hasBorder && !mediaElement) {
      element.style.setProperty("--night-dimmer-v3-border", palette.border);
      element.classList.add(BORDER_CLASS);
      styledElements.add(element);
    }

    if (element.shadowRoot) {
      prepareRoot(element.shadowRoot);
    }
  }

  function scheduleQueue() {
    if (queueScheduled || !darkModeEnabled) {
      return;
    }

    queueScheduled = true;
    const scheduledGeneration = generation;
    const run = (deadline) => {
      queueScheduled = false;

      if (!darkModeEnabled || scheduledGeneration !== generation) {
        return;
      }

      const palette = DARK_PALETTES[darkModeLevel] || DARK_PALETTES.balanced;
      let processed = 0;

      while (
        elementQueue.length &&
        processed < 180 &&
        (!deadline || deadline.timeRemaining() > 1)
      ) {
        processElement(elementQueue.pop(), palette);
        processed += 1;
      }

      if (elementQueue.length) {
        scheduleQueue();
      }
    };

    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(run, { timeout: 120 });
    } else {
      setTimeout(() => run(null), 0);
    }
  }

  function queueSubtree(node) {
    if (!(node instanceof Element) && !(node instanceof ShadowRoot)) {
      return;
    }

    if (node instanceof Element) {
      elementQueue.push(node);
    }

    const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
    let current;
    while ((current = walker.nextNode())) {
      elementQueue.push(current);
    }

    scheduleQueue();
  }

  function observeRoot(root) {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            queueSubtree(node);
          }
        }
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    observers.push(observer);
  }

  function prepareRoot(root) {
    if (preparedRoots.has(root)) {
      return;
    }

    preparedRoots.add(root);
    ensureDarkStyles(root);
    queueSubtree(root);
    observeRoot(root);
  }

  function disableDarkMode() {
    generation += 1;
    darkModeEnabled = false;
    elementQueue = [];
    queueScheduled = false;

    for (const observer of observers.splice(0)) {
      observer.disconnect();
    }

    for (const element of styledElements) {
      element.classList.remove(BG_CLASS, TEXT_CLASS, BORDER_CLASS);
      element.style.removeProperty("--night-dimmer-v3-bg");
      element.style.removeProperty("--night-dimmer-v3-text");
      element.style.removeProperty("--night-dimmer-v3-border");
    }
    styledElements.clear();

    for (const style of injectedStyles) {
      style.remove();
    }
    injectedStyles.clear();
    preparedRoots.clear();

    document.documentElement?.classList.remove(ROOT_CLASS);
    document.documentElement?.style.removeProperty("--night-dimmer-v3-root-bg");
  }

  function enableDarkMode(level) {
    disableDarkMode();
    darkModeEnabled = true;
    darkModeLevel = DARK_PALETTES[level] ? level : "balanced";
    const palette = DARK_PALETTES[darkModeLevel];

    document.documentElement.classList.add(ROOT_CLASS);
    document.documentElement.style.setProperty(
      "--night-dimmer-v3-root-bg",
      palette.root,
    );
    prepareRoot(document.documentElement);
  }

  function setDarkMode(enabled, level) {
    const normalizedLevel = DARK_PALETTES[level] ? level : "balanced";

    if (enabled === darkModeEnabled && normalizedLevel === darkModeLevel) {
      return;
    }

    if (enabled) {
      enableDarkMode(normalizedLevel);
    } else {
      disableDarkMode();
      darkModeLevel = normalizedLevel;
    }
  }

  function applySettings(settings = {}) {
    const enabled = settings.enabled === true;
    const brightness = Math.min(100, Math.max(10, Number(settings.brightness) || 70));
    const comfort = Math.min(100, Math.max(0, Number(settings.comfort) || 0));
    const dimmer = getOrCreateOverlay(DIMMER_ID, { background: "#000000" });
    const comfortOverlay = getOrCreateOverlay(COMFORT_ID, {
      background: "#ffb347",
      "mix-blend-mode": "multiply",
    });

    if (dimmer && comfortOverlay) {
      const dimOpacity = TOP_FRAME && enabled ? (100 - brightness) / 100 : 0;
      const comfortOpacity =
        TOP_FRAME && enabled && settings.comfortEnabled
          ? (comfort / 100) * 0.42
          : 0;

      dimmer.style.setProperty("opacity", String(dimOpacity), "important");
      dimmer.style.setProperty(
        "visibility",
        dimOpacity > 0 ? "visible" : "hidden",
        "important",
      );
      comfortOverlay.style.setProperty(
        "opacity",
        String(comfortOpacity),
        "important",
      );
      comfortOverlay.style.setProperty(
        "visibility",
        comfortOpacity > 0 ? "visible" : "hidden",
        "important",
      );
    }

    setDarkMode(enabled && settings.darkModeEnabled, settings.darkModeLevel);
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "NIGHT_DIMMER_EFFECTIVE_SETTINGS") {
      applySettings(message.settings);
    }
  });

  async function refreshSettings() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "NIGHT_DIMMER_GET_SETTINGS",
      });
      if (response?.ok) {
        applySettings(response.settings);
      }
    } catch (error) {
      console.warn("Night Dimmer: falha ao obter as configurações.", error);
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      void refreshSettings();
    }
  });

  void refreshSettings();
})();
