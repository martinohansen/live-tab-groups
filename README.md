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

Each query fetches up to 100 results. Sorting applies to those fetched
results.

## GitHub sign-in

The extension searches GitHub with your github.com sign-in in Firefox. It
needs no access token, so it also works with organizations that enforce SAML
single sign-on.

Enter one query per line in **Search queries**. Settings save automatically.
Use `@me` for your GitHub username.

Sync stops and keeps existing tabs when you are not signed in to github.com,
or when the SSO session for an organization has expired. To continue, open
github.com, authenticate with the organization, and sync again.

The extension reads the JSON response of the github.com search page. GitHub
does not document this response, so a change on GitHub can stop sync until the
extension is updated.

## Screenshots

![settings page](settings.png)

## Development

Run the tests with `node --test tests/*.test.cjs` (Node.js 18.0 or newer).
Lint the extension with `web-ext lint --ignore-files 'tests/**'`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for release instructions.
