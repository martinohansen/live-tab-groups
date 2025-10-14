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

// Find or return null if group doesn't exist
async function findOrCreateGroup(windowId, title, color) {
  // If group exists, update and return it
  const existing = await findGroupByTitle(title, windowId);
  if (existing) {
    await browser.tabGroups.update(existing.id, { title, color });
    return existing.id;
  }

  // Return null - group will be created when first tab is added
  return null;
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
    // Check if group exists (returns null if not)
    let groupId = await findOrCreateGroup(windowId, config.groupTitle, config.groupColor);

    // Fetch URLs from provider
    const urls = await provider.fetchUrls(config);

    // Find existing tabs and determine what we need to create
    const existingMap = await tabsByExactUrls(urls, provider.getTabMatchPattern());
    const need = [];
    for (const u of urls) {
      if (!existingMap.has(u)) need.push(u);
    }

    // Collect all tabs that should be in the group
    const allTabIds = Array.from(existingMap.values()).map(t => t.id);

    // Create new tabs
    const created = [];
    for (const u of need) {
      const t = await browser.tabs.create({ url: u, active: false, windowId });
      created.push(t);
      existingMap.set(u, t);
      allTabIds.push(t.id);
    }

    // If no group exists and we have tabs, create the group with all tabs at once
    if (groupId === null && allTabIds.length > 0) {
      groupId = await browser.tabs.group({ tabIds: allTabIds, createProperties: { windowId } });
      await browser.tabGroups.update(groupId, { title: config.groupTitle, color: config.groupColor });
    } else if (groupId !== null && allTabIds.length > 0) {
      // Group exists - add tabs that aren't already in it
      const tabsInExistingGroup = await tabsInGroup(groupId);
      const alreadyInGroup = new Set(tabsInExistingGroup.map(t => t.id));
      const tabsToAdd = allTabIds.filter(id => !alreadyInGroup.has(id));

      if (tabsToAdd.length) {
        await browser.tabs.group({ groupId, tabIds: tabsToAdd });
      }
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
