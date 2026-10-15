const DEFAULT_PROFILE = {
  enabled: false,
  brightness: 70,
  profileEnabled: false,
  profileBrightness: 60,
  comfortEnabled: false,
  comfort: 35,
  darkModeEnabled: false,
  darkModeLevel: "balanced",
};

const DEFAULT_UI_STATE = {
  scope: "current",
  selectedTabIds: [],
};

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

function normalizeProfile(profile = {}) {
  const validDarkLevels = new Set(["soft", "balanced", "intense"]);

  return {
    enabled:
      typeof profile.enabled === "boolean"
        ? profile.enabled
        : DEFAULT_PROFILE.enabled,
    brightness: clamp(
      profile.brightness,
      10,
      100,
      DEFAULT_PROFILE.brightness,
    ),
    profileEnabled:
      typeof profile.profileEnabled === "boolean"
        ? profile.profileEnabled
        : DEFAULT_PROFILE.profileEnabled,
    profileBrightness: clamp(
      profile.profileBrightness,
      10,
      100,
      DEFAULT_PROFILE.profileBrightness,
    ),
    comfortEnabled:
      typeof profile.comfortEnabled === "boolean"
        ? profile.comfortEnabled
        : DEFAULT_PROFILE.comfortEnabled,
    comfort: clamp(profile.comfort, 0, 100, DEFAULT_PROFILE.comfort),
    darkModeEnabled:
      typeof profile.darkModeEnabled === "boolean"
        ? profile.darkModeEnabled
        : DEFAULT_PROFILE.darkModeEnabled,
    darkModeLevel: validDarkLevels.has(profile.darkModeLevel)
      ? profile.darkModeLevel
      : DEFAULT_PROFILE.darkModeLevel,
  };
}

function normalizeUiState(state = {}) {
  const validScopes = new Set(["current", "selected", "all"]);

  return {
    scope: validScopes.has(state.scope) ? state.scope : DEFAULT_UI_STATE.scope,
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
        clamp(brightness, 10, 100, DEFAULT_PROFILE.brightness),
      ]),
  );
}

function siteKeyFromUrl(url = "") {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:"].includes(parsedUrl.protocol)
      ? parsedUrl.origin
      : null;
  } catch (error) {
    return null;
  }
}

function normalizeSiteProfiles(values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(values)
      .filter(([siteKey]) => siteKeyFromUrl(siteKey) === siteKey)
      .map(([siteKey, profile]) => [siteKey, normalizeProfile(profile)]),
  );
}

function normalizeTabProfiles(values = {}) {
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(values)
      .filter(([tabId, record]) => {
        return (
          Number.isInteger(Number(tabId)) &&
          record &&
          typeof record === "object" &&
          siteKeyFromUrl(record.siteKey) === record.siteKey
        );
      })
      .map(([tabId, record]) => [
        tabId,
        {
          siteKey: record.siteKey,
          profile: normalizeProfile(record.profile),
        },
      ]),
  );
}

function settingsForContent(profile) {
  const normalizedProfile = normalizeProfile(profile);
  const enabled = normalizedProfile.enabled;

  return {
    enabled,
    brightness: normalizedProfile.profileEnabled
      ? normalizedProfile.profileBrightness
      : normalizedProfile.brightness,
    comfortEnabled: enabled && normalizedProfile.comfortEnabled,
    comfort: normalizedProfile.comfort,
    darkModeEnabled: enabled && normalizedProfile.darkModeEnabled,
    darkModeLevel: normalizedProfile.darkModeLevel,
  };
}

async function getSiteProfiles() {
  const { siteProfiles = {} } =
    await chrome.storage.local.get("siteProfiles");
  return normalizeSiteProfiles(siteProfiles);
}

async function getSessionState() {
  const stored = await chrome.storage.session.get({
    tabProfiles: {},
    uiState: DEFAULT_UI_STATE,
  });

  return {
    tabProfiles: normalizeTabProfiles(stored.tabProfiles),
    uiState: normalizeUiState(stored.uiState),
  };
}

function resolveProfile(tab, tabProfiles, siteProfiles) {
  const tabId = String(tab?.id);
  const siteKey = siteKeyFromUrl(tab?.url);
  const tabRecord = tabProfiles[tabId];

  if (siteKey && tabRecord?.siteKey === siteKey) {
    return { siteKey, profile: tabRecord.profile, source: "tab" };
  }

  if (siteKey && siteProfiles[siteKey]) {
    return { siteKey, profile: siteProfiles[siteKey], source: "site" };
  }

  return {
    siteKey,
    profile: { ...DEFAULT_PROFILE },
    source: "default",
  };
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

async function applyStoredProfileToTab(tabId) {
  try {
    const [tab, siteProfiles, sessionState] = await Promise.all([
      chrome.tabs.get(tabId),
      getSiteProfiles(),
      getSessionState(),
    ]);
    const resolved = resolveProfile(
      tab,
      sessionState.tabProfiles,
      siteProfiles,
    );
    const tabKey = String(tabId);
    let sessionChanged = false;

    if (resolved.source === "site") {
      sessionState.tabProfiles[tabKey] = {
        siteKey: resolved.siteKey,
        profile: resolved.profile,
      };
      sessionChanged = true;
    } else if (
      resolved.source === "default" &&
      sessionState.tabProfiles[tabKey]
    ) {
      delete sessionState.tabProfiles[tabKey];
      sessionChanged = true;
    }

    if (sessionChanged) {
      await chrome.storage.session.set({
        tabProfiles: sessionState.tabProfiles,
      });
    }
    await sendToTab(tabId, settingsForContent(resolved.profile));
  } catch (error) {
    // A aba pode ter sido fechada durante a atualização.
  }
}

async function popupState(activeTabId, visibleTabIds = []) {
  const [tabs, siteProfiles, sessionState] = await Promise.all([
    chrome.tabs.query({}),
    getSiteProfiles(),
    getSessionState(),
  ]);
  const tabsById = new Map(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => [tab.id, tab]),
  );
  const activeTab = tabsById.get(activeTabId);
  const activeProfile = activeTab
    ? resolveProfile(activeTab, sessionState.tabProfiles, siteProfiles).profile
    : DEFAULT_PROFILE;
  const activeBrightness = settingsForContent(activeProfile).brightness;
  const tabBrightness = {};

  for (const tabId of visibleTabIds.filter(Number.isInteger)) {
    const tab = tabsById.get(tabId);
    if (!tab) {
      continue;
    }

    const resolved = resolveProfile(
      tab,
      sessionState.tabProfiles,
      siteProfiles,
    );
    const brightness = settingsForContent(resolved.profile).brightness;
    if (resolved.source !== "default" && brightness !== activeBrightness) {
      tabBrightness[String(tabId)] = brightness;
    }
  }

  return {
    ...activeProfile,
    ...sessionState.uiState,
    tabBrightness,
  };
}

async function targetTabs(scope, activeTabId, selectedTabIds) {
  const tabs = await chrome.tabs.query({});
  const selectedIds = new Set(selectedTabIds);

  return tabs.filter((tab) => {
    if (!Number.isInteger(tab.id) || tab.discarded) {
      return false;
    }
    if (scope === "all") {
      return true;
    }
    if (scope === "selected") {
      return selectedIds.has(tab.id);
    }
    return tab.id === activeTabId;
  });
}

async function applyPopupState(message) {
  const profile = normalizeProfile(message.state);
  const uiState = normalizeUiState(message.state);
  const tabBrightness = normalizeTabBrightness(message.state?.tabBrightness);
  const tabs = await targetTabs(
    uiState.scope,
    message.activeTabId,
    uiState.selectedTabIds,
  );
  const [siteProfiles, sessionState] = await Promise.all([
    getSiteProfiles(),
    getSessionState(),
  ]);
  const applications = [];

  for (const tab of tabs) {
    const siteKey = siteKeyFromUrl(tab.url);
    let tabProfile = { ...profile };
    const individualBrightness = tabBrightness[String(tab.id)];

    if (uiState.scope === "selected" && individualBrightness !== undefined) {
      tabProfile = {
        ...tabProfile,
        brightness: individualBrightness,
        profileEnabled: false,
      };
    }

    if (siteKey) {
      sessionState.tabProfiles[String(tab.id)] = {
        siteKey,
        profile: tabProfile,
      };
      siteProfiles[siteKey] = tabProfile;
    }

    applications.push({ tabId: tab.id, profile: tabProfile });
  }

  await Promise.all([
    chrome.storage.local.set({ siteProfiles }),
    chrome.storage.session.set({
      tabProfiles: sessionState.tabProfiles,
      uiState,
    }),
  ]);
  const results = await Promise.all(
    applications.map(async ({ tabId, profile: tabProfile }) => ({
      targeted: tabProfile.enabled,
      delivered: await sendToTab(tabId, settingsForContent(tabProfile)),
    })),
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
    const [siteProfiles, sessionState] = await Promise.all([
      getSiteProfiles(),
      getSessionState(),
    ]);
    await Promise.all([
      chrome.storage.local.set({ siteProfiles }),
      chrome.storage.session.set(sessionState),
    ]);
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
        const [siteProfiles, sessionState] = await Promise.all([
          getSiteProfiles(),
          getSessionState(),
        ]);
        const resolved = resolveProfile(
          sender.tab,
          sessionState.tabProfiles,
          siteProfiles,
        );
        sendResponse({
          ok: true,
          settings: settingsForContent(resolved.profile),
        });
      } catch (error) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  const messageFromPopup =
    !sender.tab && sender.url === chrome.runtime.getURL("popup.html");

  if (message?.type === "NIGHT_DIMMER_GET_POPUP_STATE" && messageFromPopup) {
    void (async () => {
      try {
        const state = await popupState(
          message.activeTabId,
          message.visibleTabIds,
        );
        sendResponse({ ok: true, state });
      } catch (error) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (message?.type === "NIGHT_DIMMER_APPLY_STATE" && messageFromPopup) {
    void (async () => {
      try {
        const result = await applyPopupState(message);
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

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void applyStoredProfileToTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") {
    void applyStoredProfileToTab(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const sessionState = await getSessionState();
    delete sessionState.tabProfiles[String(tabId)];
    sessionState.uiState.selectedTabIds =
      sessionState.uiState.selectedTabIds.filter((id) => id !== tabId);
    await chrome.storage.session.set(sessionState);
  })();
});
