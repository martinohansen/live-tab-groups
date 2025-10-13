// Live Tab Groups - Background Script
// Manages dynamic tab groups from multiple providers

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

async function getCfg() {
  const { cfg } = await browser.storage.local.get("cfg");
  // Merge with defaults
  const merged = { groups: {} };
  for (const [providerId, defaultConfig] of Object.entries(DEFAULTS.groups)) {
    merged.groups[providerId] = {
      ...defaultConfig,
      ...(cfg?.groups?.[providerId] || {})
    };
  }
  return merged;
}

async function setCfg(cfg) {
  await browser.storage.local.set({ cfg });
}

// Get all registered providers
function getProviders() {
  return window.LiveTabGroupsProviders || {};
}

// Get a specific provider by ID
function getProvider(id) {
  const providers = getProviders();
  return providers[id] || null;
}

// Find tab group by title in a window
async function findGroupByTitle(title, windowId) {
  const groups = await browser.tabGroups.query({ windowId });
  const match = groups.find(g => g.title === title);
  return match || null;
}

// Ensure a tab group exists with the given tabs
async function ensureGroup(windowId, title, color, tabIds) {
  // If group exists, just group tabs into it
  const existing = await findGroupByTitle(title, windowId);
  if (existing) {
    if (tabIds.length) {
      await browser.tabs.group({ groupId: existing.id, tabIds });
    }
    await browser.tabGroups.update(existing.id, { title, color });
    return existing.id;
  }

  // Create new group using provided tabs
  if (!tabIds.length) return null;

  const groupId = await browser.tabs.group({ tabIds, createProperties: { windowId } });
  await browser.tabGroups.update(groupId, { title, color });
  return groupId;
}

// Find tabs matching specific URLs
async function tabsByExactUrls(urls, matchPattern) {
  const ghTabs = await browser.tabs.query({ url: [matchPattern] });
  const set = new Set(urls);
  const map = new Map();
  for (const t of ghTabs) {
    if (t.url && set.has(t.url)) {
      map.set(t.url, t);
    }
  }
  return map;
}

// Get tabs in a specific group
async function tabsInGroup(groupId) {
  return await browser.tabs.query({ groupId });
}

// Sync a single group provider
async function syncGroup(providerId, config, windowId) {
  const provider = getProvider(providerId);
  if (!provider) {
    console.error(`[Live Tab Groups] Provider ${providerId} not found`);
    return;
  }

  if (!config.enabled) return;

  try {
    // Fetch URLs from provider
    const urls = await provider.fetchUrls(config);

    // Ensure tabs exist for each URL
    const existingMap = await tabsByExactUrls(urls, provider.getTabMatchPattern());
    const need = [];
    for (const u of urls) {
      if (!existingMap.has(u)) need.push(u);
    }

    const created = [];
    for (const u of need) {
      const t = await browser.tabs.create({ url: u, active: false, windowId });
      created.push(t);
      existingMap.set(u, t);
    }

    // Wait for newly created tabs to start loading
    if (created.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Group tabs
    const allTabIds = Array.from(existingMap.values()).map(t => t.id);
    let groupId = null;
    if (allTabIds.length) {
      groupId = await ensureGroup(windowId, config.groupTitle, config.groupColor, allTabIds);
    } else {
      const g = await findGroupByTitle(config.groupTitle, windowId);
      groupId = g ? g.id : null;
    }

    // Prune tabs not in list
    if (config.closeMissing && groupId) {
      const inGroup = await tabsInGroup(groupId);
      const keep = new Set(urls);

      // Only close tabs that have fully loaded URLs and don't match our list
      const toClose = inGroup.filter(t => {
        if (!t.url || t.url === "about:blank") return false;
        return !keep.has(t.url);
      });

      if (toClose.length) {
        await browser.tabs.remove(toClose.map(t => t.id));
      }
    }
  } catch (error) {
    console.error(`[Live Tab Groups] Sync failed for ${providerId}:`, error);
    throw error;
  }
}

// Sync all enabled groups
async function syncAll() {
  const cfg = await getCfg();

  // Use current window
  const [win] = await browser.windows.getAll({ populate: false, windowTypes: ["normal"] });
  const windowId = win ? win.id : (await browser.windows.getCurrent()).id;

  // Sync each enabled group
  for (const [providerId, config] of Object.entries(cfg.groups)) {
    if (config.enabled) {
      try {
        await syncGroup(providerId, config, windowId);
      } catch (error) {
        console.error(`[Live Tab Groups] Failed to sync ${providerId}:`, error);
      }
    }
  }
}

// Extension installed/updated
browser.runtime.onInstalled.addListener(async () => {
  const cfg = await getCfg();
  await setCfg(cfg);
  await syncAll();

  // Set up alarms for each enabled group
  for (const [providerId, config] of Object.entries(cfg.groups)) {
    if (config.enabled) {
      await browser.alarms.create(`sync-${providerId}`, { periodInMinutes: config.pollMinutes });
    }
  }
});

// Browser started
browser.runtime.onStartup.addListener(async () => {
  await syncAll();
  const cfg = await getCfg();

  // Set up alarms for each enabled group
  for (const [providerId, config] of Object.entries(cfg.groups)) {
    if (config.enabled) {
      await browser.alarms.create(`sync-${providerId}`, { periodInMinutes: config.pollMinutes });
    }
  }
});

// Alarm triggered
browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name.startsWith("sync-")) {
    const providerId = alarm.name.replace("sync-", "");
    const cfg = await getCfg();
    const config = cfg.groups[providerId];

    if (config && config.enabled) {
      const [win] = await browser.windows.getAll({ populate: false, windowTypes: ["normal"] });
      const windowId = win ? win.id : (await browser.windows.getCurrent()).id;

      try {
        await syncGroup(providerId, config, windowId);
      } catch (err) {
        console.error(`[Live Tab Groups] Alarm sync failed for ${providerId}:`, err);
      }
    }
  }
});

// Listen for messages from options page
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "syncNow") {
    syncAll()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch(err => {
        console.error("[Live Tab Groups] Manual sync failed:", err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // Keep message channel open for async response
  }
});
