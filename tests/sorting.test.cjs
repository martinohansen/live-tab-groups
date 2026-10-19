const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = name => readFileSync(resolve(__dirname, "..", name), "utf8");
const quietConsole = { log() {}, warn() {}, error() {} };
const prUrl = id => `https://github.com/example/repo/pull/${id}`;
const pr = (id, title, day) => ({
  html_url: prUrl(id), title, created_at: `2026-01-${day}T12:00:00Z`,
  pull_request: {}
});

function providerContext(fetch) {
  const context = vm.createContext({ window: {}, fetch, URL, console: quietConsole });
  vm.runInContext(source("providers/github-prs.js"), context);
  return context;
}

for (const [sortOrder, expected] of [
  [undefined, [2, 3, 1, 4]],
  ["oldest", [2, 3, 1, 4]],
  ["newest", [4, 1, 2, 3]],
  ["title", [2, 3, 4, 1]]
]) {
  test(`provider combines, deduplicates and sorts queries: ${sortOrder || "default"}`, async () => {
    const requests = [];
    const pages = [
      [pr(1, "Zulu", "03"), pr(3, "alpha 2", "01"), { html_url: "issue" }],
      [pr(4, "Alpha 10", "04"), pr(2, "Alpha 2", "01"), pr(1, "Zulu", "03")]
    ];
    const context = providerContext(async url => {
      if (url.endsWith("/user")) return { ok: true, json: async () => ({ login: "martin" }) };
      requests.push(new URL(url));
      return { ok: true, json: async () => ({ items: pages.shift() }) };
    });
    const provider = context.window.LiveTabGroupsProviders["github-prs"];
    const urls = await provider.fetchUrls({
      token: "test", queries: ["author:@me", "", "review-requested:@me"], sortOrder
    });
    assert.deepEqual(Array.from(urls), expected.map(prUrl));
    assert.equal(requests.length, 2);
    assert.equal(requests[0].searchParams.get("q"), "author:martin");
    for (const request of requests) {
      assert.equal(request.searchParams.get("sort"), sortOrder === "title" ? null : "created");
      assert.equal(request.searchParams.get("order"), sortOrder === "title" ? null : sortOrder === "newest" ? "desc" : "asc");
    }
  });
}

function backgroundContext(initialTabs, urls, hasGroup = true) {
  const context = providerContext();
  const tabs = initialTabs.map(tab => ({ windowId: 1, groupId: -1, active: false, ...tab }));
  const moves = [];
  const removed = [];
  let nextId = 100;
  const reindex = () => tabs.forEach((tab, index) => { tab.index = index; });
  reindex();
  const event = { addListener() {} };
  context.browser = {
    runtime: {
      onInstalled: event, onStartup: event,
      onMessage: { addListener(listener) { context.onMessage = listener; } }
    },
    windows: { getAll: async () => [{ id: 1 }] },
    alarms: { onAlarm: event },
    storage: { local: { get: async () => ({ cfg: { groups: { "github-prs": { token: "saved" } } } }) } },
    tabGroups: {
      query: async () => hasGroup ? [{ id: 7, title: "GitHub PRs" }] : [],
      update: async () => {}
    },
    tabs: {
      query: async query => tabs.filter(tab =>
        (query.groupId === undefined || tab.groupId === query.groupId) &&
        (query.windowId === undefined || tab.windowId === query.windowId) &&
        (query.active === undefined || tab.active === query.active) &&
        (!query.url || tab.url.startsWith("https://github.com/"))
      ).map(tab => ({ ...tab })),
      create: async properties => {
        const tab = { ...properties, id: nextId++, groupId: -1 };
        tabs.push(tab);
        reindex();
        return { ...tab };
      },
      group: async ({ tabIds, groupId = 7 }) => {
        const selected = tabs.filter(tab => tabIds.includes(tab.id));
        for (const tab of selected) tabs.splice(tabs.indexOf(tab), 1);
        const lastGroupIndex = tabs.findLastIndex(tab => tab.groupId === groupId);
        tabs.splice(lastGroupIndex < 0 ? tabs.length : lastGroupIndex + 1, 0, ...selected);
        selected.forEach(tab => { tab.groupId = groupId; });
        reindex();
        return groupId;
      },
      remove: async ids => {
        removed.push(...ids);
        for (const id of ids) tabs.splice(tabs.findIndex(tab => tab.id === id), 1);
        reindex();
      },
      move: async (id, { index }) => {
        moves.push(id);
        const [tab] = tabs.splice(tabs.findIndex(tab => tab.id === id), 1);
        tabs.splice(index, 0, tab);
        reindex();
        return { ...tab };
      }
    }
  };
  context.window.LiveTabGroupsProviders["github-prs"].fetchUrls = async () => urls;
  vm.runInContext(source("background.js"), context);
  return { context, tabs, moves, removed };
}

const config = { enabled: true, groupTitle: "GitHub PRs", groupColor: "blue", closeMissing: true };

test("sync sorts existing and new tabs, preserves sub-pages and selection, and prunes missing PRs", async () => {
  const { context, tabs, moves, removed } = backgroundContext([
    { id: 10, url: "https://example.com/" },
    { id: 3, url: prUrl(3), groupId: 7 },
    { id: 1, url: `${prUrl(1)}/files`, groupId: 7, active: true },
    { id: 9, url: prUrl(9), groupId: 7 },
    { id: 11, url: "https://example.org/" }
  ], [prUrl(1), prUrl(2), prUrl(3)]);
  await context.syncGroup("github-prs", config, 1);
  assert.deepEqual(tabs.map(tab => tab.id), [10, 1, 100, 3, 11]);
  assert.deepEqual(removed, [9]);
  assert.equal(tabs[1].url, `${prUrl(1)}/files`);
  assert.equal(tabs[1].active, true);
  assert.ok(tabs.slice(1, 4).every(tab => tab.groupId === 7));
  moves.length = 0;
  await context.syncGroup("github-prs", config, 1);
  assert.equal(moves.length, 0, "an already sorted group needs no moves");
});

test("sync sorts a new group with a mix of existing and newly created tabs", async () => {
  const { context, tabs } = backgroundContext([
    { id: 3, url: prUrl(3) },
    { id: 1, url: prUrl(1) }
  ], [prUrl(1), prUrl(2), prUrl(3)], false);
  await context.syncGroup("github-prs", config, 1);
  assert.deepEqual(tabs.map(tab => tab.url), [prUrl(1), prUrl(2), prUrl(3)]);
  assert.ok(tabs.every(tab => tab.groupId === 7));
});

test("retained tabs follow sorted results and active tabs outside the group stay outside", async () => {
  const { context, tabs, removed } = backgroundContext([
    { id: 1, url: prUrl(1), active: true },
    { id: 9, url: prUrl(9), groupId: 7 },
    { id: 3, url: prUrl(3), groupId: 7 },
    { id: 8, url: prUrl(8), groupId: 7 },
    { id: 2, url: prUrl(2), groupId: 7 }
  ], [prUrl(1), prUrl(2), prUrl(3)]);
  await context.syncGroup("github-prs", { ...config, closeMissing: false }, 1);
  assert.deepEqual(tabs.map(tab => tab.id), [1, 2, 3, 9, 8]);
  assert.equal(tabs[0].groupId, -1);
  assert.deepEqual(removed, []);
});

test("existing configuration gains oldest-first sorting without losing saved settings", async () => {
  const { context } = backgroundContext([], []);
  const cfg = await context.getCfg();
  assert.equal(cfg.groups["github-prs"].sortOrder, "oldest");
  assert.equal(cfg.groups["github-prs"].token, "saved");
});

function manualSync(context) {
  return new Promise(resolve => {
    assert.equal(context.onMessage({ action: "syncNow" }, {}, resolve), true);
  });
}

test("manual sync reports a rejected token and preserves existing tabs", async () => {
  const { context, tabs, removed } = backgroundContext([
    { id: 1, url: prUrl(1), groupId: 7 }
  ], []);
  context.fetch = async () => ({ ok: false, status: 401 });
  vm.runInContext('window.LiveTabGroupsProviders["github-prs"] = new GitHubPRProvider()', context);
  const result = await manualSync(context);
  assert.equal(result.success, false);
  assert.match(result.error, /401 Bad credentials.*Replace the token/);
  assert.equal(tabs.length, 1);
  assert.deepEqual(removed, []);
});

test("a failed search aborts partial results before tabs change", async () => {
  const { context, tabs, removed } = backgroundContext([
    { id: 9, url: prUrl(9), groupId: 7 }
  ], []);
  let searchCount = 0;
  context.fetch = async url => {
    if (url.endsWith("/user")) return { ok: true, json: async () => ({ login: "martin" }) };
    if (++searchCount === 1) return { ok: true, json: async () => ({ items: [pr(1, "One", "01")] }) };
    return { ok: false, status: 403, json: async () => ({ message: "API rate limit exceeded" }) };
  };
  vm.runInContext('window.LiveTabGroupsProviders["github-prs"] = new GitHubPRProvider()', context);
  const result = await manualSync(context);
  assert.equal(result.success, false);
  assert.match(result.error, /GitHub search failed \(403\): API rate limit exceeded/);
  assert.deepEqual(tabs.map(tab => tab.id), [9]);
  assert.deepEqual(removed, []);
});

test("provider rejects missing tokens, blank queries, and network errors", async () => {
  const context = providerContext(async () => { throw new Error("NetworkError"); });
  const provider = context.window.LiveTabGroupsProviders["github-prs"];
  await assert.rejects(provider.fetchUrls({}), /GitHub token is required/);
  provider.getUsername = async () => "martin";
  await assert.rejects(provider.fetchUrls({ token: "test", queries: [" "] }), /search query is required/);
  await assert.rejects(provider.fetchUrls({ token: "test", queries: ["author:@me"] }), /Query "author:@me": NetworkError/);
  context.fetch = async () => ({ ok: false, status: 502, statusText: "Bad Gateway", json: async () => { throw new Error("Invalid JSON"); } });
  await assert.rejects(provider.fetchUrls({ token: "test", queries: ["author:@me"] }), /GitHub search failed \(502\): Bad Gateway/);
});

test("manual sync explains empty results and disabled providers", async () => {
  const { context } = backgroundContext([], [], false);
  let result = await manualSync(context);
  assert.equal(result.success, true);
  assert.match(result.message, /No pull requests matched/);
  context.browser.storage.local.get = async () => ({ cfg: { groups: { "github-prs": { enabled: false } } } });
  result = await manualSync(context);
  assert.equal(result.success, false);
  assert.match(result.error, /No providers are enabled/);
});

test("manual sync explains why empty results preserve an existing group", async () => {
  const { context, removed } = backgroundContext([{ id: 1, url: prUrl(1), groupId: 7 }], []);
  const result = await manualSync(context);
  assert.equal(result.success, true);
  assert.match(result.message, /Existing tabs were kept for safety/);
  assert.deepEqual(removed, []);
});

for (const result of [
  { success: false, error: "GitHub rejected the token" },
  undefined,
  { success: true, message: "Synced 3 pull request(s); created 1 tab(s)." }
]) {
  test(`options reports the background result: ${JSON.stringify(result)}`, async () => {
    const elements = {};
    const events = [];
    const context = vm.createContext({
      console: quietConsole, setTimeout() {}, clearTimeout() {},
      document: {
        addEventListener() {},
        getElementById: id => elements[id] ||= { value: "", style: {} }
      },
      browser: {
        storage: { local: { set: async () => { events.push("save"); } } },
        alarms: { clear: async () => {} },
        runtime: { sendMessage: async () => { events.push("sync"); return result; } }
      }
    });
    vm.runInContext(source("options.js"), context);
    await context.syncNow();
    assert.deepEqual(events, ["save", "sync"]);
    assert.equal(elements.syncStatus.className, `status-message ${result?.success ? "success" : "error"}`);
    assert.equal(elements.syncStatus.textContent, result?.success ? result.message
      : `Sync failed: ${result?.error || "The background script did not return a sync result."}`);
    assert.equal(elements.syncNow.disabled, false);
  });
}
