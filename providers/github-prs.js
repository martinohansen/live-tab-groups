// GitHub PR Provider for Live Tab Groups
// This provider syncs GitHub pull requests into a tab group

class GitHubPRProvider {
  constructor() {
    this.id = "github-prs";
    this.name = "GitHub Pull Requests";
    this.description = "Syncs your GitHub PRs into a tab group";
  }

  getQueries(config) {
    const queries = Array.isArray(config.queries) ? config.queries : [config.query || ""];
    return [...new Set(queries.map(query => query.trim()).filter(Boolean))];
  }

  // Search with the Firefox GitHub sign-in. Organizations that enforce SAML or
  // conditional access accept the browser session, so there is no token to
  // re-authorize. The endpoint is the JSON form of the github.com search page
  // and is not a documented API.
  async fetchUrls(config) {
    const queries = this.getQueries(config);
    if (!queries.length) throw new Error("At least one GitHub search query is required.");

    const maxPages = 10;
    const sortOrder = config.sortOrder || "oldest";
    const sort = sortOrder === "title" ? "" : `&s=created&o=${sortOrder === "newest" ? "desc" : "asc"}`;
    const allPRs = new Map();

    for (const query of queries) {
      for (let page = 1; page <= maxPages; page++) {
        const url = `https://github.com/search?q=${encodeURIComponent(query)}&type=pullrequests${sort}&p=${page}`;
        let search;
        try {
          const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
          if (!r.ok) throw new Error(`GitHub search failed (${r.status}).`);
          search = (await r.json().catch(() => ({})))?.payload?.blackbirdSearchRoute;
        } catch (error) {
          throw new Error(`Query "${query}": ${error.message}`);
        }
        // Stop on an unknown response shape so that sync never closes tabs
        // because of a parsing failure.
        if (!Array.isArray(search?.results)) {
          throw new Error(`Query "${query}": GitHub returned an unexpected search response.`);
        }
        if (!search.logged_in) {
          throw new Error("Not signed in to github.com in Firefox. Sign in and sync again.");
        }
        // GitHub leaves out results from organizations whose SSO session has
        // expired and lists those organizations here.
        if (search.protected_org_logins?.length) {
          throw new Error(`Query "${query}": SSO session expired for ${search.protected_org_logins.join(", ")}. `
            + "Open github.com, authenticate with the organization, and sync again.");
        }
        if (search.errors?.length) {
          throw new Error(`Query "${query}": ${search.errors.map(error => error.message || error).join("; ")}`);
        }

        for (const result of search.results) {
          const owner = result.repo?.repository?.owner_login;
          const repo = result.repo?.repository?.name;
          if (!owner || !repo || !result.number) continue;
          const html_url = `https://github.com/${owner}/${repo}/pull/${result.number}`;
          // Titles contain highlight markup for matched search terms.
          const title = (result.hl_title || "").replace(/<[^>]*>/g, "");
          allPRs.set(html_url, { html_url, title, created_at: result.created });
        }
        console.log(`[${this.id}] Query "${query}" page ${page}/${search.page_count}: ${search.results.length} PRs`);
        if (page >= search.page_count) break;
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
      query: "is:pr is:open involves:@me archived:false",
      groupTitle: "GitHub PRs",
      groupColor: "blue",
      sortOrder: "oldest",
      pollMinutes: 5,
      closeMissing: true
    };
  }

  validateConfig(config) {
    const errors = [];
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
