const DEFAULT_STATE = {
  enabled: true,
  brightness: 70,
  profileEnabled: false,
  profileBrightness: 60,
  comfortEnabled: false,
  comfort: 35,
  darkModeEnabled: false,
  darkModeLevel: "balanced",
  scope: "all",
  selectedTabIds: [],
};

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

function normalizeState(state = {}) {
  const validScopes = new Set(["current", "selected", "all"]);
  const validDarkLevels = new Set(["soft", "balanced", "intense"]);

  return {
    enabled:
      typeof state.enabled === "boolean" ? state.enabled : DEFAULT_STATE.enabled,
    brightness: clamp(state.brightness, 10, 100, DEFAULT_STATE.brightness),
    profileEnabled:
      typeof state.profileEnabled === "boolean"
        ? state.profileEnabled
        : DEFAULT_STATE.profileEnabled,
    profileBrightness: clamp(
      state.profileBrightness,
      10,
      100,
      DEFAULT_STATE.profileBrightness,
    ),
    comfortEnabled:
      typeof state.comfortEnabled === "boolean"
        ? state.comfortEnabled
        : DEFAULT_STATE.comfortEnabled,
    comfort: clamp(state.comfort, 0, 100, DEFAULT_STATE.comfort),
    darkModeEnabled:
      typeof state.darkModeEnabled === "boolean"
        ? state.darkModeEnabled
        : DEFAULT_STATE.darkModeEnabled,
    darkModeLevel: validDarkLevels.has(state.darkModeLevel)
      ? state.darkModeLevel
      : DEFAULT_STATE.darkModeLevel,
    scope: validScopes.has(state.scope) ? state.scope : DEFAULT_STATE.scope,
    selectedTabIds: Array.isArray(state.selectedTabIds)
      ? [...new Set(state.selectedTabIds.filter(Number.isInteger))]
      : [],
  };
}

function settingsForTab(state, tabId) {
  const tabIsSelected =
    state.scope === "all" || state.selectedTabIds.includes(tabId);
  const enabled = state.enabled && tabIsSelected;

  return {
    enabled,
    brightness: state.profileEnabled
      ? state.profileBrightness
      : state.brightness,
    comfortEnabled: enabled && state.comfortEnabled,
    comfort: state.comfort,
    darkModeEnabled: enabled && state.darkModeEnabled,
    darkModeLevel: state.darkModeLevel,
  };
}

async function getState() {
  return normalizeState(await chrome.storage.local.get(DEFAULT_STATE));
}

async function sendToTab(tabId, settings) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "NIGHT_DIMMER_EFFECTIVE_SETTINGS",
      settings,
    });
    return true;
  } catch (error) {
    if (!settings.enabled) {
      return false;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        files: ["content.js"],
      });

      await chrome.tabs.sendMessage(tabId, {
        type: "NIGHT_DIMMER_EFFECTIVE_SETTINGS",
        settings,
      });
      return true;
    } catch (injectionError) {
      // Abas internas e lojas de extensões recusam injeção por segurança.
      return false;
    }
  }
}

async function broadcastState(state) {
  const tabs = await chrome.tabs.query({});
  const results = await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map(async (tab) => {
        const settings = settingsForTab(state, tab.id);
        return {
          targeted: settings.enabled,
          delivered: await sendToTab(tab.id, settings),
        };
      }),
  );

  return {
    targeted: results.filter((result) => result.targeted).length,
    delivered: results.filter(
      (result) => result.targeted && result.delivered,
    ).length,
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const state = await getState();
    await chrome.storage.local.set(state);
  })();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "NIGHT_DIMMER_GET_SETTINGS") {
    void (async () => {
      try {
        const state = await getState();
        sendResponse({
          ok: true,
          settings: settingsForTab(state, sender.tab?.id),
        });
      } catch (error) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (message?.type === "NIGHT_DIMMER_APPLY_STATE") {
    void (async () => {
      try {
        const state = normalizeState(message.state);
        await chrome.storage.local.set(state);
        const result = await broadcastState(state);
        sendResponse({ ok: true, ...result });
      } catch (error) {
        console.error("Night Dimmer: falha ao aplicar as configurações.", error);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const state = await getState();

    if (!state.selectedTabIds.includes(tabId)) {
      return;
    }

    state.selectedTabIds = state.selectedTabIds.filter((id) => id !== tabId);
    await chrome.storage.local.set(state);
  })();
});
