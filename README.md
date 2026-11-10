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

## GitHub tokens

In the extension settings, enter one token per line in **GitHub tokens**.
Enter one query per line in **Search queries**. Settings save automatically.
Blank lines and duplicate tokens are ignored.

Use `@me` for the username associated with each token. A query must succeed
with at least one token. Tokens without access to its organization or repository
are skipped for that query. Other errors stop sync and keep existing tabs.
Errors identify tokens by their position in the list.

For fine-grained tokens, select the required repositories and grant
**Pull requests: Read-only**. Organization access may require administrator
approval. Classic tokens need the `repo` scope for private repositories.

## Screenshots

![settings page](settings.png)

## Development

Run the tests with `node --test tests/*.test.cjs` (Node.js 18.0 or newer).
Lint the extension with `web-ext lint --ignore-files 'tests/**'`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for release instructions.
