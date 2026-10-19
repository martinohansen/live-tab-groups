# Live Tab Groups

A Firefox extension that automatically creates and maintains tab groups from
dynamic sources.

## Features

* Automatically sync **GitHub pull requests** based on your search queries like
PRs you're reviewing, assigned to you, where you're mentioned or you created.
* Sort PR tabs by creation date (oldest first by default, or newest first) or
alphabetically by PR title (A–Z, ignoring case).

Choose **Sort PRs** in the extension settings. The order applies to results
combined across all queries, including tabs that are already open. Use **Sync
Now** to apply it immediately, or wait for the next scheduled sync. Tabs kept
outside the current results appear at the end of the group. Sorting keeps the
active tab selected and preserves PR sub-pages such as `/files`.

Each query currently fetches up to 100 results. Sorting applies to those fetched
results.

## Screenshots

![settings page](settings.png)

## Development

Run the sorting tests with `node --test tests/*.test.cjs` (Node.js 18.0 or newer).
Lint the extension with `web-ext lint --ignore-files 'tests/**'`.

## Release

1. Bump `manifest.json`; run the tests and lint commands above.
2. Commit and push with GitButler; record the release branch commit SHA.
3. Create the GitHub tag (replace VERSION and RELEASE_SHA):
   `gh api repos/martinohansen/live-tab-groups/git/refs -f ref=refs/tags/vVERSION -f sha=RELEASE_SHA`.
4. Build: `web-ext build --ignore-files 'tests/**' 'AGENTS.md' 'CLAUDE.md' 'settings.png' '.claude/**'`.
5. In the [Mozilla dashboard](https://addons.mozilla.org/en-US/developers/addon/live-tab-groups/versions),
   select **New Version**, upload the ZIP, add release notes, submit, and select
   **No** for generated source. Verify **Version Submitted**.
