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
}

function updateScopeVisibility() {
  elements.tabPicker.hidden = selectedScope() !== "selected";
}

function renderState(state) {
  currentState = {
    ...DEFAULT_STATE,
    ...state,
  };
  elements.enabled.checked = state.enabled !== false;
  elements.profileEnabled.checked = state.profileEnabled === true;
  elements.profileBrightness.value = String(
    clamp(
      state.profileBrightness,
      10,
      100,
      DEFAULT_STATE.profileBrightness,
    ),
  );
  updateBrightnessDisplay(
    state.profileEnabled ? state.profileBrightness : state.brightness,
  );
  elements.comfortEnabled.checked = state.comfortEnabled === true;
  elements.comfort.value = String(
    clamp(state.comfort, 0, 100, DEFAULT_STATE.comfort),
  );
  elements.comfortValue.value = `${elements.comfort.value}%`;
  elements.darkModeEnabled.checked = state.darkModeEnabled === true;
  elements.darkModeLevel.value = ["soft", "balanced", "intense"].includes(
    state.darkModeLevel,
  )
    ? state.darkModeLevel
    : DEFAULT_STATE.darkModeLevel;

  const scopeRadio = elements.scopes.find((radio) => radio.value === state.scope);
  (scopeRadio || elements.scopes.at(-1)).checked = true;

  for (const checkbox of elements.tabList.querySelectorAll(
    'input[type="checkbox"]',
  )) {
    checkbox.checked = state.selectedTabIds?.includes(Number(checkbox.value));
  }

  updateDisabledState();
  updateScopeVisibility();
  updateTabCount();
}

function collectState() {
  const scope = selectedScope();
  let tabIds = [];

  if (scope === "current" && Number.isInteger(activeTabId)) {
    tabIds = [activeTabId];
  } else if (scope === "selected") {
    tabIds = selectedTabIds();
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
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  const thumbnail = document.createElement("span");
  const image = document.createElement("img");
  const initial = document.createElement("span");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  const meta = document.createElement("span");
  const domain = hostnameFromUrl(tab.url);
  const recency = formatLastAccessed(tab.lastAccessed);

  label.className = [
    "tab-row",
    protectedTab ? "protected" : "",
    tab.active ? "current" : "",
  ]
    .filter(Boolean)
    .join(" ");
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
    /^(data:image\/|https?:|chrome:|brave:|edge:)/i.test(tab.favIconUrl)
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

  checkbox.addEventListener("change", () => {
    updateTabCount();
    scheduleApply();
  });
  label.append(checkbox, thumbnail, copy);
  return label;
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
  applyState();
});

void (async () => {
  try {
    await loadTabs();
    renderState(await chrome.storage.local.get(DEFAULT_STATE));
  } catch (error) {
    console.error("Night Dimmer: falha ao iniciar o popup.", error);
    renderState(DEFAULT_STATE);
    showStatus("Não foi possível carregar as configurações.", true);
  }
})();
