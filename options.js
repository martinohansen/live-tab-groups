const DEFAULTS = {
  groups: {
    "github-prs": {
      enabled: true,
      token: "",
      queries: [
        "is:pr is:open review-requested:@me",
        "is:pr is:open assignee:@me",
        "is:pr is:open mentions:@me",
        "is:pr is:open author:@me"
      ],
      groupTitle: "GitHub PRs",
      groupColor: "blue",
      sortOrder: "oldest",
      pollMinutes: 5,
      closeMissing: true
    }
  }
};

let loadedConfig = DEFAULTS;
function readTokens() {
  return [...new Set(document.getElementById("github-prs-tokens").value.split("\n")
    .map(token => token.trim()).filter(Boolean))];
}

async function loadOptions() {
  const { cfg } = await browser.storage.local.get("cfg");
  const config = cfg || DEFAULTS;
  loadedConfig = config;

  // Load GitHub PRs configuration
  const githubConfig = config.groups?.["github-prs"] || DEFAULTS.groups["github-prs"];

  document.getElementById("github-prs-enabled").checked = githubConfig.enabled !== false;
  const provider = window.LiveTabGroupsProviders["github-prs"];
  document.getElementById("github-prs-tokens").value = provider.getTokens(githubConfig)
    .map(entry => entry.token).join("\n");
  const hasQueries = Array.isArray(githubConfig.queries) || githubConfig.query !== undefined
    || githubConfig.tokens?.some(entry => Array.isArray(entry.queries));
  document.getElementById("github-prs-queries").value = provider.getQueries(
    hasQueries ? githubConfig : DEFAULTS.groups["github-prs"]
  ).join("\n");

  document.getElementById("github-prs-groupTitle").value = githubConfig.groupTitle || "";
  document.getElementById("github-prs-groupColor").value = githubConfig.groupColor || "blue";
  document.getElementById("github-prs-sortOrder").value = githubConfig.sortOrder || "oldest";
  document.getElementById("github-prs-pollMinutes").value = githubConfig.pollMinutes || 5;
  document.getElementById("github-prs-closeMissing").checked = githubConfig.closeMissing !== false;
}

async function saveOptions() {
  const cfg = {
    ...loadedConfig,
    groups: {
      ...loadedConfig.groups,
      "github-prs": {
        enabled: document.getElementById("github-prs-enabled").checked,
        tokens: readTokens(),
        queries: document.getElementById("github-prs-queries").value.split("\n")
          .map(query => query.trim()).filter(Boolean),
        groupTitle: document.getElementById("github-prs-groupTitle").value.trim() || "GitHub PRs",
        groupColor: document.getElementById("github-prs-groupColor").value,
        sortOrder: document.getElementById("github-prs-sortOrder").value,
        pollMinutes: Math.max(1, parseInt(document.getElementById("github-prs-pollMinutes").value || "5", 10)),
        closeMissing: document.getElementById("github-prs-closeMissing").checked
      }
    }
  };

  await browser.storage.local.set({ cfg });
  loadedConfig = cfg;

  // Clear and recreate alarms
  for (const [providerId, config] of Object.entries(cfg.groups)) {
    await browser.alarms.clear(`sync-${providerId}`);
    if (config.enabled) {
      await browser.alarms.create(`sync-${providerId}`, { periodInMinutes: config.pollMinutes });
    }
  }
}

async function autoSave() {
  try {
    await saveOptions();
  } catch (error) {
    showStatus(`Could not save settings: ${error.message}`, true);
  }
}

function showStatus(message, isError = false) {
  const statusEl = document.getElementById("syncStatus");
  statusEl.textContent = message;
  statusEl.className = "status-message " + (isError ? "error" : "success");
  statusEl.style.display = "block";

  clearTimeout(showStatus.timeout);
  if (!isError) {
    showStatus.timeout = setTimeout(() => {
      statusEl.style.display = "none";
    }, 3000);
  }
}

async function syncNow() {
  const button = document.getElementById("syncNow");
  button.disabled = true;
  button.textContent = "Syncing...";

  try {
    // Send message to background script to trigger sync
    await saveOptions();
    const result = await browser.runtime.sendMessage({ action: "syncNow" });
    if (!result?.success) {
      throw new Error(result?.error || "The background script did not return a sync result.");
    }
    showStatus(result.message);
  } catch (error) {
    showStatus(`Sync failed: ${error.message}`, true);
    console.error("Sync error:", error);
  } finally {
    button.disabled = false;
    button.textContent = "Sync Now";
  }
}

// Set up event listeners
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await loadOptions();
  } catch (error) {
    showStatus(`Could not load settings: ${error.message}`, true);
    return;
  }

  // Auto-save on any change
  const inputs = [
    "github-prs-enabled",
    "github-prs-tokens",
    "github-prs-queries",
    "github-prs-groupTitle",
    "github-prs-groupColor",
    "github-prs-sortOrder",
    "github-prs-pollMinutes",
    "github-prs-closeMissing"
  ];

  inputs.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("change", autoSave);
      // Also save on input for text fields (more responsive)
      if (element.type === "text" || element.type === "password" || element.tagName === "TEXTAREA") {
        element.addEventListener("input", debounce(autoSave, 500));
      }
    }
  });

  document.getElementById("syncNow").addEventListener("click", syncNow);
});

// Debounce helper for auto-save
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
