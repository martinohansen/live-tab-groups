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
      pollMinutes: 5,
      closeMissing: true
    }
  }
};

async function loadOptions() {
  const { cfg } = await browser.storage.local.get("cfg");
  const config = cfg || DEFAULTS;

  // Load GitHub PRs configuration
  const githubConfig = config.groups?.["github-prs"] || DEFAULTS.groups["github-prs"];

  document.getElementById("github-prs-enabled").checked = githubConfig.enabled !== false;
  document.getElementById("github-prs-token").value = githubConfig.token || "";

  // Handle both old single query and new queries array
  let queries = githubConfig.queries;
  if (githubConfig.query && !Array.isArray(githubConfig.queries)) {
    queries = [githubConfig.query];
  }
  // If no queries configured, use defaults
  if (!queries || queries.length === 0) {
    queries = DEFAULTS.groups["github-prs"].queries;
  }
  document.getElementById("github-prs-queries").value = queries.join("\n");

  document.getElementById("github-prs-groupTitle").value = githubConfig.groupTitle || "";
  document.getElementById("github-prs-groupColor").value = githubConfig.groupColor || "blue";
  document.getElementById("github-prs-pollMinutes").value = githubConfig.pollMinutes || 5;
  document.getElementById("github-prs-closeMissing").checked = githubConfig.closeMissing !== false;

  // Handle enable/disable UI
  updateGroupCardState("github-prs", githubConfig.enabled !== false);
}

function updateGroupCardState(providerId, enabled) {
  const card = document.getElementById(`${providerId}-card`);
  if (enabled) {
    card.classList.remove("disabled");
  } else {
    card.classList.add("disabled");
  }
}

async function saveOptions() {
  // Parse queries from textarea (one per line)
  const queriesText = document.getElementById("github-prs-queries").value;
  const queries = queriesText
    .split("\n")
    .map(q => q.trim())
    .filter(q => q.length > 0);

  const cfg = {
    groups: {
      "github-prs": {
        enabled: document.getElementById("github-prs-enabled").checked,
        token: document.getElementById("github-prs-token").value.trim(),
        queries: queries,
        groupTitle: document.getElementById("github-prs-groupTitle").value.trim() || "GitHub PRs",
        groupColor: document.getElementById("github-prs-groupColor").value,
        pollMinutes: Math.max(1, parseInt(document.getElementById("github-prs-pollMinutes").value || "5", 10)),
        closeMissing: document.getElementById("github-prs-closeMissing").checked
      }
    }
  };

  await browser.storage.local.set({ cfg });

  // Clear and recreate alarms
  for (const [providerId, config] of Object.entries(cfg.groups)) {
    await browser.alarms.clear(`sync-${providerId}`);
    if (config.enabled) {
      await browser.alarms.create(`sync-${providerId}`, { periodInMinutes: config.pollMinutes });
    }
  }

  showSyncStatus("Settings saved successfully!");
}

function showSyncStatus(message, isError = false) {
  const statusEl = document.getElementById("syncStatus");
  statusEl.textContent = message;
  statusEl.style.display = "block";
  statusEl.style.backgroundColor = isError ? "#fee" : "#efe";
  statusEl.style.border = isError ? "1px solid #d73a49" : "1px solid #28a745";
  statusEl.style.color = isError ? "#d73a49" : "#28a745";

  // Auto-hide after 5 seconds
  setTimeout(() => {
    statusEl.style.display = "none";
  }, 5000);
}

async function syncNow() {
  const button = document.getElementById("syncNow");
  button.disabled = true;
  button.textContent = "Syncing...";

  try {
    // Send message to background script to trigger sync
    await browser.runtime.sendMessage({ action: "syncNow" });
    showSyncStatus("Sync completed successfully!");
  } catch (error) {
    showSyncStatus(`Sync failed: ${error.message}`, true);
    console.error("Sync error:", error);
  } finally {
    button.disabled = false;
    button.textContent = "Sync Now";
  }
}

// Set up event listeners
document.addEventListener("DOMContentLoaded", () => {
  loadOptions();

  // Enable/disable toggle
  document.getElementById("github-prs-enabled").addEventListener("change", (e) => {
    updateGroupCardState("github-prs", e.target.checked);
  });

  document.getElementById("save").addEventListener("click", saveOptions);
  document.getElementById("syncNow").addEventListener("click", syncNow);
});
