// GitHub PR Provider for Live Tab Groups
// This provider syncs GitHub pull requests into a tab group

class GitHubPRProvider {
  constructor() {
    this.id = "github-prs";
    this.name = "GitHub Pull Requests";
    this.description = "Syncs your GitHub PRs into a tab group";
  }

  // Get GitHub username from token
  async getUsername(config) {
    const r = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json"
      }
    });
    if (!r.ok) {
      throw new Error(r.status === 401
        ? "GitHub rejected the token (401 Bad credentials). Replace the token in settings."
        : `GitHub /user failed (${r.status}). Check token access and try again.`);
    }
    const j = await r.json();
    return j.login;
  }

  getTokens(config) {
    if (Array.isArray(config.tokens)) {
      return config.tokens.map(entry => ({ token: typeof entry === "string" ? entry : entry.token }));
    }
    return [{ token: config.token || "" }];
  }

  getQueries(config) {
    // Saved token entries can contain queries that must remain available.
    const tokenQueries = config.tokens?.filter(entry => Array.isArray(entry.queries));
    const queries = tokenQueries?.length
      ? tokenQueries.flatMap(entry => entry.queries)
      : Array.isArray(config.queries) ? config.queries : [config.query || config.queries || ""];
    return [...new Set(queries.map(query => query.trim()).filter(Boolean))];
  }

  // Fetch PR URLs from GitHub API
  async fetchUrls(config) {
    const tokens = this.getTokens(config);
    const errors = this.validateTokens(tokens);
    const queries = this.getQueries(config);
    if (!queries.length) errors.push("At least one GitHub search query is required.");
    if (errors.length) throw new Error(errors.join("\n"));

    const allPRs = new Map();
    const successfulQueries = new Set();
    const accessErrors = new Map(queries.map(query => [query, []]));
    const sortOrder = config.sortOrder || "oldest";

    for (const [index, entry] of tokens.entries()) {
      const label = `Token ${index + 1}`;
      try {
        const username = await this.getUsername(entry);
        for (const query of queries) {
          const resolvedQuery = query.replace(/@me/g, username);
          const ageSort = sortOrder === "title" ? "" : `&sort=created&order=${sortOrder === "newest" ? "desc" : "asc"}`;
          const url = `https://api.github.com/search/issues?q=${encodeURIComponent(resolvedQuery)}&per_page=100${ageSort}`;

          console.log(`[${this.id}] Executing query: "${query}"`);
          console.log(`[${this.id}] Resolved to: "${resolvedQuery}"`);

          try {
            const r = await fetch(url, {
              headers: {
                Authorization: `Bearer ${entry.token}`,
                Accept: "application/vnd.github+json"
              }
            });

            if (!r.ok) {
              const details = await r.json().catch(() => ({}));
              const validationErrors = Array.isArray(details.errors) ? details.errors : [];
              const message = [details.message || r.statusText,
                ...validationErrors.map(error => typeof error === "string" ? error : error.message)
              ].filter(Boolean).join(": ");
              const searchError = `GitHub search failed (${r.status}): ${message}`;
              // Organization-scoped tokens can reject queries that another token can run.
              const inaccessibleScope = r.status === 422 && (
                validationErrors.some(error =>
                  error.resource === "Search" && error.field === "q" && error.code === "invalid"
                  && error.message?.includes("cannot be searched")
                  && error.message.includes("permission"))
                || (message.includes("Access to the requested organization (")
                  && message.includes("blocked by SAML single sign-on"))
              );
              if (inaccessibleScope) {
                accessErrors.get(query).push(`${label}: ${searchError}`);
                continue;
              }
              throw new Error(searchError);
            }

            const j = await r.json();
            successfulQueries.add(query);
            console.log(`[${this.id}] Query returned ${j.total_count} total results, ${j.items?.length || 0} items in this page`);

            // Keep only PRs
            const prs = (j.items || [])
              .filter(it => it.pull_request && it.html_url);

            console.log(`[${this.id}] Found ${prs.length} PRs from this query`);
            prs.forEach(pr => allPRs.set(pr.html_url, pr));
          } catch (error) {
            throw new Error(`Query "${query}": ${error.message}`);
          }
        }
      } catch (error) {
        throw new Error(`${label}: ${error.message}`);
      }
    }

    for (const query of queries) {
      if (!successfulQueries.has(query)) {
        throw new Error(`Query "${query}": ${accessErrors.get(query).join("; ")}`);
      }
    }

    // Sort after merging so query order and duplicate results do not affect tab order.
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    const prs = Array.from(allPRs.values()).sort((a, b) => {
      const comparison = sortOrder === "title"
        ? collator.compare(a.title || "", b.title || "")
        : (Date.parse(a.created_at) - Date.parse(b.created_at)) * (sortOrder === "newest" ? -1 : 1);
      // Use the URL as a stable tie-breaker to avoid reshuffling equal dates or titles.
      return comparison || collator.compare(a.html_url, b.html_url);
    });

    console.log(`[${this.id}] ✓ Total unique PRs found: ${allPRs.size}`);
    return prs.map(pr => pr.html_url);
  }

  // Match pattern for tabs that could belong to this group
  getTabMatchPattern() {
    return "*://github.com/*/*/pull/*";
  }

  // Check if a URL belongs to this provider
  matchesUrl(url) {
    try {
      const u = new URL(url);
      return u.hostname === "github.com" && /\/pull\/\d+/.test(u.pathname);
    } catch {
      return false;
    }
  }

  // Normalize PR URL to base form (remove sub-paths like /files, /commits, etc.)
  normalizeUrl(url) {
    try {
      const u = new URL(url);
      if (u.hostname === "github.com") {
        // Match /owner/repo/pull/123 and strip everything after the PR number
        const match = u.pathname.match(/^(\/[^/]+\/[^/]+\/pull\/\d+)/);
        if (match) {
          return `${u.origin}${match[1]}`;
        }
      }
      return url;
    } catch {
      return url;
    }
  }

  // Get default configuration for this provider
  getDefaultConfig() {
    return {
      enabled: true,
      token: "",
      query: "is:pr is:open involves:@me archived:false",
      groupTitle: "GitHub PRs",
      groupColor: "blue",
      sortOrder: "oldest",
      pollMinutes: 5,
      closeMissing: true
    };
  }

  validateTokens(tokens) {
    if (!tokens.length) return ["GitHub token is required. Add a token in settings."];
    const errors = [];
    tokens.forEach((entry, index) => {
      const label = `Token ${index + 1}`;
      if (!entry.token?.trim()) errors.push(`${label}: GitHub token is required.`);
    });
    return errors;
  }

  validateConfig(config) {
    const errors = this.validateTokens(this.getTokens(config));
    if (!this.getQueries(config).length) errors.push("At least one GitHub search query is required.");
    if (!config.groupTitle) errors.push("Group title is required");
    return errors;
  }
}

// Register this provider globally
if (typeof window.LiveTabGroupsProviders === "undefined") {
  window.LiveTabGroupsProviders = {};
}
window.LiveTabGroupsProviders["github-prs"] = new GitHubPRProvider();
