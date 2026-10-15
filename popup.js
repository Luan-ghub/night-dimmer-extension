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
  tabBrightness: {},
};

const elements = {
  enabled: document.querySelector("#enabled"),
  brightness: document.querySelector("#brightness"),
  brightnessValue: document.querySelector("#brightness-value"),
  brightnessPresets: [
    ...document.querySelectorAll("[data-brightness]"),
  ],
  profileEnabled: document.querySelector("#profile-enabled"),
  profileBrightness: document.querySelector("#profile-brightness"),
  saveProfile: document.querySelector("#save-profile"),
  comfortEnabled: document.querySelector("#comfort-enabled"),
  comfort: document.querySelector("#comfort"),
  comfortValue: document.querySelector("#comfort-value"),
  darkModeEnabled: document.querySelector("#dark-mode-enabled"),
  darkModeLevel: document.querySelector("#dark-mode-level"),
  scopes: [...document.querySelectorAll('input[name="scope"]')],
  tabPicker: document.querySelector("#tab-picker"),
  tabList: document.querySelector("#tab-list"),
  tabCount: document.querySelector("#tab-count"),
  selectAllTabs: document.querySelector("#select-all-tabs"),
  status: document.querySelector("#status"),
};

let activeTabId = null;
let saveTimer = null;
let currentState = { ...DEFAULT_STATE };

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, Math.round(number)))
    : fallback;
}

function isProtectedUrl(url = "") {
  return (
    /^(chrome|brave|edge|about|devtools|view-source):/i.test(url) ||
    /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore|microsoftedge\.microsoft\.com\/addons)/i.test(
      url,
    )
  );
}

function hostnameFromUrl(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || new URL(url).protocol;
  } catch (error) {
    return "Página do navegador";
  }
}

function formatLastAccessed(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return "";
  }

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds}s atrás`;
  }

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}min atrás`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours}h atrás`;
}

function showStatus(message, isError = false) {
  elements.status.textContent = message;
  elements.status.classList.toggle("error", isError);
}

function selectedScope() {
  return elements.scopes.find((radio) => radio.checked)?.value || "all";
}

function selectedTabIds() {
  return [...elements.tabList.querySelectorAll('input[type="checkbox"]:checked')]
    .map((checkbox) => Number(checkbox.value))
    .filter(Number.isInteger);
}

function selectedTabsAcrossWindows() {
  const visibleTabIds = new Set(
    [...elements.tabList.querySelectorAll('input[type="checkbox"]')]
      .map((checkbox) => Number(checkbox.value))
      .filter(Number.isInteger),
  );
  const savedTabIds = Array.isArray(currentState.selectedTabIds)
    ? currentState.selectedTabIds
    : [];
  const selectedInOtherWindows = savedTabIds.filter(
    (tabId) => !visibleTabIds.has(tabId),
  );

  return [...new Set([...selectedInOtherWindows, ...selectedTabIds()])];
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

function currentGlobalBrightness() {
  return elements.profileEnabled.checked
    ? clamp(
        elements.profileBrightness.value,
        10,
        100,
        DEFAULT_STATE.profileBrightness,
      )
    : clamp(
        elements.brightness.value,
        10,
        100,
        DEFAULT_STATE.brightness,
      );
}

function updateTabBrightnessDisplay(slider, value) {
  const brightness = clamp(value, 10, 100, currentGlobalBrightness());
  slider.value = String(brightness);
  slider.parentElement.querySelector(".tab-brightness-value").textContent =
    `${brightness}%`;
}

function renderTabBrightness() {
  const fallback = currentGlobalBrightness();

  for (const slider of elements.tabList.querySelectorAll(
    ".tab-brightness-range",
  )) {
    const savedValue = currentState.tabBrightness[slider.dataset.tabId];
    updateTabBrightnessDisplay(slider, savedValue ?? fallback);
  }
}

function updateTabCount() {
  const selected = selectedTabIds().length;
  const available = elements.tabList.querySelectorAll(
    'input[type="checkbox"]:not(:disabled)',
  ).length;
  elements.tabCount.textContent = `(${selected}/${available})`;
  elements.selectAllTabs.textContent =
    selected === available && available > 0 ? "Limpar" : "Todas";
}

function updateDisabledState() {
  const enabled = elements.enabled.checked;
  elements.brightness.disabled = !enabled || elements.profileEnabled.checked;
  elements.profileEnabled.disabled = !enabled;
  elements.comfortEnabled.disabled = !enabled;
  elements.comfort.disabled = !enabled || !elements.comfortEnabled.checked;
  elements.darkModeEnabled.disabled = !enabled;
  elements.darkModeLevel.disabled = !enabled || !elements.darkModeEnabled.checked;

  for (const preset of elements.brightnessPresets) {
    preset.disabled = !enabled;
  }

  for (const slider of elements.tabList.querySelectorAll(
    ".tab-brightness-range",
  )) {
    const checkbox = slider.closest(".tab-row").querySelector(
      'input[type="checkbox"]',
    );
    slider.disabled = !enabled || checkbox.disabled || !checkbox.checked;
    slider.parentElement.classList.toggle("disabled", slider.disabled);
  }
}

function updateBrightnessDisplay(value) {
  const brightness = clamp(value, 10, 100, DEFAULT_STATE.brightness);
  elements.brightness.value = String(brightness);
  elements.brightnessValue.value = `${brightness}%`;

  for (const preset of elements.brightnessPresets) {
    preset.classList.toggle(
      "active",
      Number(preset.dataset.brightness) === brightness,
    );
  }

  if (currentState.tabBrightness) {
    renderTabBrightness();
  }
}

function updateScopeVisibility() {
  elements.tabPicker.hidden = selectedScope() !== "selected";
}

function renderState(state) {
  const selectedTabIds = Array.isArray(state.selectedTabIds)
    ? state.selectedTabIds
    : [];
  currentState = {
    ...DEFAULT_STATE,
    ...state,
    selectedTabIds,
    tabBrightness: normalizeTabBrightness(state.tabBrightness),
  };
  elements.enabled.checked = currentState.enabled !== false;
  elements.profileEnabled.checked = currentState.profileEnabled === true;
  elements.profileBrightness.value = String(
    clamp(
      currentState.profileBrightness,
      10,
      100,
      DEFAULT_STATE.profileBrightness,
    ),
  );
  updateBrightnessDisplay(
    currentState.profileEnabled
      ? currentState.profileBrightness
      : currentState.brightness,
  );
  elements.comfortEnabled.checked = currentState.comfortEnabled === true;
  elements.comfort.value = String(
    clamp(currentState.comfort, 0, 100, DEFAULT_STATE.comfort),
  );
  elements.comfortValue.value = `${elements.comfort.value}%`;
  elements.darkModeEnabled.checked = currentState.darkModeEnabled === true;
  elements.darkModeLevel.value = ["soft", "balanced", "intense"].includes(
    currentState.darkModeLevel,
  )
    ? currentState.darkModeLevel
    : DEFAULT_STATE.darkModeLevel;

  const scopeRadio = elements.scopes.find(
    (radio) => radio.value === currentState.scope,
  );
  (scopeRadio || elements.scopes.at(-1)).checked = true;

  for (const checkbox of elements.tabList.querySelectorAll(
    'input[type="checkbox"]',
  )) {
    checkbox.checked = selectedTabIds.includes(Number(checkbox.value));
  }

  renderTabBrightness();
  updateDisabledState();
  updateScopeVisibility();
  updateTabCount();
}

function collectState() {
  const scope = selectedScope();
  let tabIds = Array.isArray(currentState.selectedTabIds)
    ? currentState.selectedTabIds
    : [];

  if (scope === "selected") {
    tabIds = selectedTabsAcrossWindows();
  }

  return {
    enabled: elements.enabled.checked,
    brightness: elements.profileEnabled.checked
      ? clamp(currentState.brightness, 10, 100, 70)
      : clamp(elements.brightness.value, 10, 100, 70),
    profileEnabled: elements.profileEnabled.checked,
    profileBrightness: clamp(
      elements.profileBrightness.value,
      10,
      100,
      DEFAULT_STATE.profileBrightness,
    ),
    comfortEnabled: elements.comfortEnabled.checked,
    comfort: clamp(elements.comfort.value, 0, 100, 35),
    darkModeEnabled: elements.darkModeEnabled.checked,
    darkModeLevel: elements.darkModeLevel.value,
    scope,
    selectedTabIds: tabIds,
    tabBrightness: { ...currentState.tabBrightness },
  };
}

async function applyState() {
  const state = collectState();
  currentState = state;

  if (state.enabled && state.scope === "selected" && !state.selectedTabIds.length) {
    showStatus("Selecione ao menos uma aba.", true);
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      type: "NIGHT_DIMMER_APPLY_STATE",
      state,
      activeTabId,
    });

    if (!response?.ok) {
      throw new Error("O serviço da extensão não respondeu.");
    }

    if (response.targeted > 0 && response.delivered === 0) {
      showStatus("As abas escolhidas são protegidas pelo navegador.", true);
    } else if (response.delivered < response.targeted) {
      showStatus("Aplicado. Algumas páginas protegidas foram ignoradas.");
    } else {
      showStatus("Configuração aplicada.");
    }
  } catch (error) {
    console.error("Night Dimmer: falha ao aplicar as configurações.", error);
    showStatus("Não foi possível aplicar a configuração.", true);
  }
}

function scheduleApply() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(applyState, 90);
}

function createTabRow(tab) {
  const protectedTab = isProtectedUrl(tab.url);
  const row = document.createElement("div");
  const tabLabel = document.createElement("label");
  const checkbox = document.createElement("input");
  const thumbnail = document.createElement("span");
  const image = document.createElement("img");
  const initial = document.createElement("span");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  const brightnessControl = document.createElement("div");
  const brightness = document.createElement("input");
  const brightnessValue = document.createElement("span");
  const domain = hostnameFromUrl(tab.url);
  const recency = formatLastAccessed(tab.lastAccessed);

  row.className = [
    "tab-row",
    protectedTab ? "protected" : "",
    tab.active ? "current" : "",
  ]
    .filter(Boolean)
    .join(" ");
  tabLabel.className = "tab-main";
  checkbox.type = "checkbox";
  checkbox.value = String(tab.id);
  checkbox.disabled = protectedTab;

  thumbnail.className = "tab-thumbnail fallback";
  initial.className = "tab-initial";
  initial.textContent = (tab.title || domain || "?").trim().charAt(0).toUpperCase();
  image.alt = "";
  image.addEventListener("load", () => thumbnail.classList.remove("fallback"));
  image.addEventListener("error", () => image.remove());
  if (
    tab.favIconUrl &&
    /^(data:image\/|https:)/i.test(tab.favIconUrl)
  ) {
    image.src = tab.favIconUrl;
  }
  thumbnail.append(initial, image);

  copy.className = "tab-copy";
  title.className = "tab-title";
  title.textContent = tab.title || domain || `Aba ${tab.id}`;
  title.title = title.textContent;
  meta.className = "tab-meta";
  meta.textContent = [domain, recency].filter(Boolean).join(" · ");
  copy.append(title, meta);

  brightnessControl.className = "tab-brightness";
  brightness.type = "range";
  brightness.className = "tab-brightness-range";
  brightness.min = "10";
  brightness.max = "100";
  brightness.step = "1";
  brightness.value = String(DEFAULT_STATE.brightness);
  brightness.dataset.tabId = String(tab.id);
  brightness.setAttribute(
    "aria-label",
    `Brilho individual da aba ${tab.title || domain || tab.id}`,
  );
  brightnessValue.className = "tab-brightness-value";
  brightnessValue.textContent = `${DEFAULT_STATE.brightness}%`;
  brightnessControl.append(brightness, brightnessValue);

  checkbox.addEventListener("change", () => {
    updateTabCount();
    updateDisabledState();
    scheduleApply();
  });
  brightness.addEventListener("input", () => {
    const value = clamp(
      brightness.value,
      10,
      100,
      currentGlobalBrightness(),
    );
    const tabId = String(tab.id);

    updateTabBrightnessDisplay(brightness, value);
    if (value === currentGlobalBrightness()) {
      delete currentState.tabBrightness[tabId];
    } else {
      currentState.tabBrightness[tabId] = value;
    }
    scheduleApply();
  });
  brightness.addEventListener("change", () => {
    clearTimeout(saveTimer);
    applyState();
  });

  tabLabel.append(checkbox, thumbnail, copy);
  row.append(tabLabel, brightnessControl);
  return row;
}

async function loadTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  activeTabId = tabs.find((tab) => tab.active)?.id ?? null;

  for (const tab of tabs) {
    if (Number.isInteger(tab.id)) {
      elements.tabList.appendChild(createTabRow(tab));
    }
  }
}

elements.enabled.addEventListener("change", () => {
  updateDisabledState();
  applyState();
});

elements.brightness.addEventListener("input", () => {
  updateBrightnessDisplay(elements.brightness.value);
  scheduleApply();
});
elements.brightness.addEventListener("change", applyState);

for (const preset of elements.brightnessPresets) {
  preset.addEventListener("click", () => {
    const value = clamp(preset.dataset.brightness, 10, 100, 70);

    if (elements.profileEnabled.checked) {
      elements.profileBrightness.value = String(value);
    }

    updateBrightnessDisplay(value);
    applyState();
  });
}

elements.profileEnabled.addEventListener("change", () => {
  const value = elements.profileEnabled.checked
    ? elements.profileBrightness.value
    : currentState.brightness;
  updateBrightnessDisplay(value);
  updateDisabledState();
  applyState();
});

elements.saveProfile.addEventListener("click", () => {
  const value = clamp(
    elements.profileBrightness.value,
    10,
    100,
    DEFAULT_STATE.profileBrightness,
  );
  elements.profileBrightness.value = String(value);

  if (elements.profileEnabled.checked) {
    updateBrightnessDisplay(value);
  }

  applyState();
  showStatus("Perfil de brilho salvo.");
});

elements.comfortEnabled.addEventListener("change", () => {
  updateDisabledState();
  applyState();
});

elements.comfort.addEventListener("input", () => {
  elements.comfortValue.value = `${elements.comfort.value}%`;
  scheduleApply();
});
elements.comfort.addEventListener("change", applyState);

elements.darkModeEnabled.addEventListener("change", () => {
  updateDisabledState();
  applyState();
});
elements.darkModeLevel.addEventListener("change", applyState);

for (const radio of elements.scopes) {
  radio.addEventListener("change", () => {
    updateScopeVisibility();
    applyState();
  });
}

elements.selectAllTabs.addEventListener("click", () => {
  const checkboxes = [
    ...elements.tabList.querySelectorAll(
      'input[type="checkbox"]:not(:disabled)',
    ),
  ];
  const shouldSelect = !checkboxes.every((checkbox) => checkbox.checked);
  for (const checkbox of checkboxes) {
    checkbox.checked = shouldSelect;
  }
  updateTabCount();
  updateDisabledState();
  applyState();
});

void (async () => {
  try {
    await loadTabs();
    const visibleTabIds = [
      ...elements.tabList.querySelectorAll('input[type="checkbox"]'),
    ]
      .map((checkbox) => Number(checkbox.value))
      .filter(Number.isInteger);
    const response = await chrome.runtime.sendMessage({
      type: "NIGHT_DIMMER_GET_POPUP_STATE",
      activeTabId,
      visibleTabIds,
    });

    if (!response?.ok) {
      throw new Error("O serviço da extensão não respondeu.");
    }

    renderState(response.state);
  } catch (error) {
    console.error("Night Dimmer: falha ao iniciar o popup.", error);
    renderState(DEFAULT_STATE);
    showStatus("Não foi possível carregar as configurações.", true);
  }
})();
