# Contributing

## Release

1. Bump `manifest.json`; run `node --test tests/*.test.cjs` and
   `web-ext lint --ignore-files 'tests/**'`.
2. Commit and push with GitButler; record the release branch commit SHA.
3. Create the GitHub tag (replace VERSION and RELEASE_SHA):
   `gh api repos/martinohansen/live-tab-groups/git/refs -f ref=refs/tags/vVERSION -f sha=RELEASE_SHA`.
4. Build: `web-ext build --ignore-files 'tests/**' 'AGENTS.md' 'CLAUDE.md' 'settings.png' '.claude/**'`.
5. In the [Mozilla dashboard](https://addons.mozilla.org/en-US/developers/addon/live-tab-groups/versions),
   select **New Version**, upload the ZIP, add release notes, submit, and select
   **No** for generated source. Verify **Version Submitted**.
