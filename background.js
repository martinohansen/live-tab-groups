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

// Find tabs matching specific URLs (with provider-specific normalization)
async function tabsByExactUrls(urls, matchPattern, provider) {
  const ghTabs = await browser.tabs.query({ url: [matchPattern] });

  // Normalize the expected URLs if provider supports it
  const normalizedExpected = new Set();
  const normalizedToOriginal = new Map();
  for (const url of urls) {
    const normalized = provider.normalizeUrl ? provider.normalizeUrl(url) : url;
    normalizedExpected.add(normalized);
    normalizedToOriginal.set(normalized, url);
  }

  const map = new Map();
  for (const t of ghTabs) {
    if (!t.url) continue;

    // Normalize the tab URL for comparison
    const normalized = provider.normalizeUrl ? provider.normalizeUrl(t.url) : t.url;

    if (normalizedExpected.has(normalized)) {
      // Log when we match a tab with a different sub-path
      if (provider.normalizeUrl && normalized !== t.url) {
        console.log(`[Live Tab Groups] Matched tab at sub-path: ${t.url} → ${normalized}`);
      }

      // Map back to the original URL from our list
      const originalUrl = normalizedToOriginal.get(normalized);
      map.set(originalUrl, t);
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

  if (!config.enabled) {
    console.log(`[Live Tab Groups] ${providerId} is disabled, skipping sync`);
    return;
  }

  console.log(`[Live Tab Groups] Starting sync for ${providerId}`);

  try {
    // Check if group exists (returns null if not)
    let groupId = await findOrCreateGroup(windowId, config.groupTitle, config.groupColor);
    console.log(`[Live Tab Groups] Group ID: ${groupId ? groupId : 'null (will create)'}`);

    // Fetch URLs from provider
    const urls = await provider.fetchUrls(config);
    console.log(`[Live Tab Groups] Fetched ${urls.length} URLs from provider`);

    // SAFEGUARD: If API returns 0 results but we have existing tabs, something might be wrong
    // Don't close all tabs unless we're sure the API is working correctly
    if (urls.length === 0 && groupId !== null) {
      const existingTabs = await tabsInGroup(groupId);
      if (existingTabs.length > 0) {
        console.warn(`[Live Tab Groups] ⚠️ API returned 0 URLs but group has ${existingTabs.length} tabs. Skipping sync to prevent data loss. This might indicate an API error or auth issue.`);
        return;
      }
    }

    // Find existing tabs and determine what we need to create
    const existingMap = await tabsByExactUrls(urls, provider.getTabMatchPattern(), provider);
    console.log(`[Live Tab Groups] Found ${existingMap.size} existing tabs matching our URLs`);

    const need = [];
    for (const u of urls) {
      if (!existingMap.has(u)) need.push(u);
    }
    console.log(`[Live Tab Groups] Need to create ${need.length} new tabs`);

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
    if (created.length > 0) {
      console.log(`[Live Tab Groups] Created ${created.length} new tabs`);
    }

    // If no group exists and we have tabs, create the group with all tabs at once
    if (groupId === null && allTabIds.length > 0) {
      console.log(`[Live Tab Groups] Creating new group with ${allTabIds.length} tabs`);
      groupId = await browser.tabs.group({ tabIds: allTabIds, createProperties: { windowId } });
      await browser.tabGroups.update(groupId, { title: config.groupTitle, color: config.groupColor });
      console.log(`[Live Tab Groups] Group created with ID: ${groupId}`);
    } else if (groupId !== null && allTabIds.length > 0) {
      // Group exists - add tabs that aren't already in it
      const tabsInExistingGroup = await tabsInGroup(groupId);
      const alreadyInGroup = new Set(tabsInExistingGroup.map(t => t.id));
      const tabsToAdd = allTabIds.filter(id => !alreadyInGroup.has(id));

      if (tabsToAdd.length) {
        console.log(`[Live Tab Groups] Adding ${tabsToAdd.length} tabs to existing group`);
        await browser.tabs.group({ groupId, tabIds: tabsToAdd });
      }
    }

    // Prune tabs not in list
    if (config.closeMissing && groupId) {
      const inGroup = await tabsInGroup(groupId);

      // Normalize URLs for comparison
      const keepNormalized = new Set();
      for (const url of urls) {
        const normalized = provider.normalizeUrl ? provider.normalizeUrl(url) : url;
        keepNormalized.add(normalized);
      }

      // Only close tabs that have fully loaded URLs and don't match our list
      const toClose = inGroup.filter(t => {
        if (!t.url || t.url === "about:blank") return false;
        const normalized = provider.normalizeUrl ? provider.normalizeUrl(t.url) : t.url;
        return !keepNormalized.has(normalized);
      });

      if (toClose.length > 0) {
        console.log(`[Live Tab Groups] Closing ${toClose.length} tabs no longer in query results`);
        console.log(`[Live Tab Groups] Tabs to close:`, toClose.map(t => t.url));

        // SAFEGUARD: If we're about to close ALL tabs, log a warning
        if (toClose.length === inGroup.length) {
          console.warn(`[Live Tab Groups] ⚠️ About to close ALL ${toClose.length} tabs in the group! This will delete the group.`);
        }

        await browser.tabs.remove(toClose.map(t => t.id));
      } else {
        console.log(`[Live Tab Groups] No tabs need to be closed`);
      }
    }

    console.log(`[Live Tab Groups] ✓ Sync completed successfully for ${providerId}`);
  } catch (error) {
    console.error(`[Live Tab Groups] ✗ Sync failed for ${providerId}:`, error);
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
