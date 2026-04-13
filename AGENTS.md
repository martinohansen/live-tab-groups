# AGENTS.md

This file provides guidance to coding agents when working with code in this
repository.

## Project Overview

Live Tab Groups is a Firefox Manifest V3 extension that automatically creates
and maintains tab groups from dynamic sources. It currently supports syncing
GitHub pull requests into tab groups based on customizable search queries.

## Architecture

### Provider System

The extension uses a provider-based architecture where each data source (for
example GitHub PRs) is implemented as a provider:

- Providers register themselves in `window.LiveTabGroupsProviders`
- `fetchUrls(config)`: Return the array of URLs to sync
- `getTabMatchPattern()`: Return the browser match pattern for tabs
- `matchesUrl(url)`: Check whether a URL belongs to the provider
- `normalizeUrl(url)` (optional): Normalize URLs for comparison
- `getDefaultConfig()`: Return the default configuration object
- `validateConfig(config)`: Return an array of validation errors

Providers are loaded in `manifest.json` under `background.scripts` before
`background.js` so they are registered before the main script runs.

### Core Components

`background.js`

- `syncGroup(providerId, config, windowId)`: Sync a single provider's tabs into
  a group
- `syncAll()`: Sync all enabled providers
- Event listeners: `onInstalled`, `onStartup`, and `onAlarm` handle periodic
  sync
- Message listener handles manual "Sync Now" requests from the options page

`providers/github-prs.js`

- Uses the GitHub Search API to find PRs based on queries
- Supports `@me` token replacement with the authenticated username
- Combines results from multiple queries with deduplication
- Normalizes PR URLs by stripping sub-paths such as `/files`, `/commits`, and
  `/checks` so tabs remain stable while navigating within a PR

`options.js` and `options.html`

- Provide the configuration UI
- Save per-provider settings such as enablement, token, queries, group title,
  group color, poll interval, and close-missing behavior
- Recreate alarms when settings are saved
- Expose a "Sync Now" button that sends a message to the background script

## Configuration

Configuration is stored in `browser.storage.local` under `cfg`:

```javascript
{
  groups: {
    "github-prs": {
      enabled: true,
      token: "ghp_...",
      queries: ["is:pr is:open review-requested:@me"],
      groupTitle: "GitHub PRs",
      groupColor: "blue",
      pollMinutes: 5,
      closeMissing: true
    }
  }
}
```

Default configuration is defined in both `background.js` and `options.js`
through `DEFAULTS` and merged with user settings on load.

## Tab Group Management

- `findOrCreateGroup(windowId, title, color)`: Find an existing group by title
  and update it, or return `null` if it does not exist
- `findGroupByTitle(title, windowId)`: Find an existing group by title
- `tabsByExactUrls(urls, matchPattern)`: Find existing tabs matching exact URLs
- `tabsInGroup(groupId)`: Get all tabs in a group

Groups are created lazily with tabs to avoid empty-group deletion. When
`groupId` is `null`, all existing and newly created tabs are collected, then
`browser.tabs.group()` creates the group and `browser.tabGroups.update()` sets
the title and color.

This avoids the Firefox behavior where creating an empty group with a temporary
tab and then removing it causes the group to be deleted automatically.

## Polling Mechanism

- Uses the `browser.alarms` API for periodic sync
- Creates an alarm named `sync-{providerId}` for each enabled provider
- Recreates alarms on settings save and extension start
- Supports a configurable poll interval per provider

## Development Commands

### Testing the Extension

Load the extension temporarily in Firefox:

1. Navigate to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `manifest.json`

Or use `web-ext`:

```bash
web-ext run
```

### Build for Distribution

```bash
web-ext build
```

The build output appears in `web-ext-artifacts/`.

### Lint

```bash
web-ext lint
```

## Adding New Providers

1. Create a provider file in `providers/`
2. Implement the provider interface using `providers/github-prs.js` as a
   reference
3. Register the provider with
   `window.LiveTabGroupsProviders["provider-id"] = new YourProvider()`
4. Add it to `manifest.json` under `background.scripts` before `background.js`
5. Add default config to `DEFAULTS` in both `background.js` and `options.js`
6. Add the UI section to `options.html`
7. Add save and load logic to `options.js`
8. Update `host_permissions` in `manifest.json` if needed

## Important Notes

- Extension requires Firefox 139.0 or newer for the tab groups API
- All provider scripts must load before `background.js` in `manifest.json`
- Tab groups work per window; the current implementation uses the first normal
  window
- Groups are created lazily with tabs rather than empty to prevent Firefox from
  auto-deleting them
- Configuration merge logic ensures new defaults are applied even if the user
  has saved settings
