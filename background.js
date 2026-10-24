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

function normalizeTabIds(values = []) {
  return Array.isArray(values)
    ? [...new Set(values.filter(Number.isInteger))]
    : [];
}

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
    selectedTabIds: normalizeTabIds(state.selectedTabIds),
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

function pageKeyFromUrl(url = "") {
  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return null;
    }
    parsedUrl.hash = "";
    return parsedUrl.href;
  } catch (error) {
    return null;
  }
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
          typeof record.pageKey === "string" &&
          pageKeyFromUrl(record.pageKey) === record.pageKey
        );
      })
      .map(([tabId, record]) => [
        tabId,
        {
          pageKey: record.pageKey,
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

async function getSessionState() {
  const stored = await chrome.storage.session.get({
    tabProfiles: {},
    uiState: DEFAULT_UI_STATE,
    allTabsProfile: null,
    appliedTabIds: [],
  });

  return {
    tabProfiles: normalizeTabProfiles(stored.tabProfiles),
    uiState: normalizeUiState(stored.uiState),
    allTabsProfile: stored.allTabsProfile
      ? normalizeProfile(stored.allTabsProfile)
      : null,
    appliedTabIds: normalizeTabIds(stored.appliedTabIds),
  };
}

function resolveProfile(
  tab,
  tabProfiles,
  uiState = DEFAULT_UI_STATE,
  allTabsProfile = null,
) {
  const tabId = String(tab?.id);
  const pageKey = pageKeyFromUrl(tab?.url);
  const tabRecord = tabProfiles[tabId];

  if (normalizeUiState(uiState).scope === "all" && allTabsProfile) {
    return {
      pageKey,
      profile: normalizeProfile(allTabsProfile),
      source: "all",
    };
  }

  if (pageKey && tabRecord?.pageKey === pageKey) {
    return { pageKey, profile: tabRecord.profile, source: "tab" };
  }

  return {
    pageKey,
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
    const [tab, sessionState] = await Promise.all([
      chrome.tabs.get(tabId),
      getSessionState(),
    ]);
    const resolved = resolveProfile(
      tab,
      sessionState.tabProfiles,
      sessionState.uiState,
      sessionState.allTabsProfile,
    );
    const tabKey = String(tabId);
    let sessionChanged = false;

    if (resolved.source === "all" && resolved.pageKey) {
      sessionState.tabProfiles[tabKey] = {
        pageKey: resolved.pageKey,
        profile: resolved.profile,
      };
      if (!sessionState.appliedTabIds.includes(tabId)) {
        sessionState.appliedTabIds.push(tabId);
      }
      sessionChanged = true;
    } else if (resolved.source === "default") {
      if (sessionState.tabProfiles[tabKey]) {
        delete sessionState.tabProfiles[tabKey];
        sessionChanged = true;
      }
      if (sessionState.appliedTabIds.includes(tabId)) {
        sessionState.appliedTabIds = sessionState.appliedTabIds.filter(
          (appliedTabId) => appliedTabId !== tabId,
        );
        sessionChanged = true;
      }
    }

    if (sessionChanged) {
      await chrome.storage.session.set({
        tabProfiles: sessionState.tabProfiles,
        appliedTabIds: sessionState.appliedTabIds,
      });
    }
    await sendToTab(tabId, settingsForContent(resolved.profile));
  } catch (error) {
    // A aba pode ter sido fechada durante a atualização.
  }
}

async function popupState(activeTabId, visibleTabIds = []) {
  const [tabs, sessionState] = await Promise.all([
    chrome.tabs.query({}),
    getSessionState(),
  ]);
  const tabsById = new Map(
    tabs
      .filter((tab) => Number.isInteger(tab.id))
      .map((tab) => [tab.id, tab]),
  );
  const activeTab = tabsById.get(activeTabId);
  const activeProfile = activeTab
    ? resolveProfile(
        activeTab,
        sessionState.tabProfiles,
        sessionState.uiState,
        sessionState.allTabsProfile,
      ).profile
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
      sessionState.uiState,
      sessionState.allTabsProfile,
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
  const sessionState = await getSessionState();
  const applications = [];
  const nextAppliedTabIds = tabs.map((tab) => tab.id);
  const removedTabIds = sessionState.appliedTabIds.filter(
    (tabId) => !nextAppliedTabIds.includes(tabId),
  );

  for (const tabId of removedTabIds) {
    delete sessionState.tabProfiles[String(tabId)];
  }

  for (const tab of tabs) {
    const pageKey = pageKeyFromUrl(tab.url);
    let tabProfile = { ...profile };
    const individualBrightness = tabBrightness[String(tab.id)];

    if (uiState.scope === "selected" && individualBrightness !== undefined) {
      tabProfile = {
        ...tabProfile,
        brightness: individualBrightness,
        profileEnabled: false,
      };
    }

    if (pageKey) {
      sessionState.tabProfiles[String(tab.id)] = {
        pageKey,
        profile: tabProfile,
      };
    }

    applications.push({ tabId: tab.id, profile: tabProfile });
  }

  sessionState.uiState = uiState;
  sessionState.allTabsProfile = uiState.scope === "all" ? profile : null;
  sessionState.appliedTabIds = nextAppliedTabIds;

  await chrome.storage.session.set(sessionState);
  await Promise.all(
    removedTabIds.map((tabId) => sendToTab(
      tabId,
      settingsForContent(DEFAULT_PROFILE),
    )),
  );
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
    const sessionState = await getSessionState();
    await Promise.all([
      chrome.storage.local.remove("siteProfiles"),
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
        const sessionState = await getSessionState();
        const resolved = resolveProfile(
          sender.tab,
          sessionState.tabProfiles,
          sessionState.uiState,
          sessionState.allTabsProfile,
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
    sessionState.appliedTabIds = sessionState.appliedTabIds.filter(
      (appliedTabId) => appliedTabId !== tabId,
    );
    sessionState.uiState.selectedTabIds =
      sessionState.uiState.selectedTabIds.filter((id) => id !== tabId);
    await chrome.storage.session.set(sessionState);
  })();
});
