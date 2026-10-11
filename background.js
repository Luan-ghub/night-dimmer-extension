const DEFAULT_STATE = {
  enabled: false,
  brightness: 70,
  profileEnabled: false,
  profileBrightness: 60,
  comfortEnabled: false,
  comfort: 35,
  darkModeEnabled: false,
  darkModeLevel: "balanced",
  scope: "current",
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

function normalizeTabBrightness(values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(values)
      .filter(([tabId]) => Number.isInteger(Number(tabId)))
      .map(([tabId, brightness]) => [
        tabId,
        clamp(brightness, 10, 100, DEFAULT_STATE.brightness),
      ]),
  );
}

function settingsForTab(state, tabId, tabBrightness = {}) {
  const tabIsSelected =
    state.scope === "all" || state.selectedTabIds.includes(tabId);
  const enabled = state.enabled && tabIsSelected;
  const individualBrightness =
    state.scope === "selected" ? tabBrightness[String(tabId)] : undefined;

  return {
    enabled,
    brightness:
      individualBrightness ??
      (state.profileEnabled ? state.profileBrightness : state.brightness),
    comfortEnabled: enabled && state.comfortEnabled,
    comfort: state.comfort,
    darkModeEnabled: enabled && state.darkModeEnabled,
    darkModeLevel: state.darkModeLevel,
  };
}

async function getState() {
  return normalizeState(await chrome.storage.local.get(DEFAULT_STATE));
}

async function getTabBrightness() {
  const { tabBrightness = {} } =
    await chrome.storage.session.get("tabBrightness");
  return normalizeTabBrightness(tabBrightness);
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

async function broadcastState(state, tabBrightness) {
  const tabs = await chrome.tabs.query({});
  const results = await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id) && !tab.discarded)
      .map(async (tab) => {
        const settings = settingsForTab(state, tab.id, tabBrightness);
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
  if (sender.id !== chrome.runtime.id) {
    return false;
  }

  if (
    message?.type === "NIGHT_DIMMER_GET_SETTINGS" &&
    Number.isInteger(sender.tab?.id)
  ) {
    void (async () => {
      try {
        const [state, tabBrightness] = await Promise.all([
          getState(),
          getTabBrightness(),
        ]);
        sendResponse({
          ok: true,
          settings: settingsForTab(state, sender.tab?.id, tabBrightness),
        });
      } catch (error) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (
    message?.type === "NIGHT_DIMMER_APPLY_STATE" &&
    !sender.tab &&
    sender.url === chrome.runtime.getURL("popup.html")
  ) {
    void (async () => {
      try {
        const state = normalizeState(message.state);
        const tabBrightness = normalizeTabBrightness(
          message.state?.tabBrightness,
        );
        await Promise.all([
          chrome.storage.local.set(state),
          chrome.storage.session.set({ tabBrightness }),
        ]);
        const result = await broadcastState(state, tabBrightness);
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
    const [state, tabBrightness] = await Promise.all([
      getState(),
      getTabBrightness(),
    ]);
    const brightnessKey = String(tabId);
    const tabWasSelected = state.selectedTabIds.includes(tabId);
    const tabHadCustomBrightness = brightnessKey in tabBrightness;

    if (!tabWasSelected && !tabHadCustomBrightness) {
      return;
    }

    state.selectedTabIds = state.selectedTabIds.filter((id) => id !== tabId);
    delete tabBrightness[brightnessKey];
    await Promise.all([
      chrome.storage.local.set(state),
      chrome.storage.session.set({ tabBrightness }),
    ]);
  })();
});
