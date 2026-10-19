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

  // Fetch PR URLs from GitHub API
  async fetchUrls(config) {
    if (!config.token) {
      throw new Error("GitHub token is required. Add a token in settings.");
    }

    console.log(`[${this.id}] Fetching username...`);
    const username = await this.getUsername(config);
    console.log(`[${this.id}] Username: ${username}`);

    const queries = Array.isArray(config.queries) ? config.queries : [config.query || config.queries];
    if (!queries.some(query => query && query.trim())) {
      throw new Error("At least one GitHub search query is required.");
    }
    console.log(`[${this.id}] Processing ${queries.length} queries`);
    const allPRs = new Map();
    const sortOrder = config.sortOrder || "oldest";

    // Execute all queries and combine results
    for (const query of queries) {
      if (!query || !query.trim()) continue;

      const resolvedQuery = query.replace(/@me/g, username);
      const ageSort = sortOrder === "title" ? "" : `&sort=created&order=${sortOrder === "newest" ? "desc" : "asc"}`;
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(resolvedQuery)}&per_page=100${ageSort}`;

      console.log(`[${this.id}] Executing query: "${query}"`);
      console.log(`[${this.id}] Resolved to: "${resolvedQuery}"`);

      try {
        const r = await fetch(url, {
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/vnd.github+json"
          }
        });

        if (!r.ok) {
          const details = await r.json().catch(() => ({}));
          throw new Error(`GitHub search failed (${r.status}): ${details.message || r.statusText}`);
        }

        const j = await r.json();
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

  // Validate configuration
  validateConfig(config) {
    const errors = [];
    if (!config.token) {
      errors.push("GitHub token is required");
    }
    if (!config.query) {
      errors.push("Search query is required");
    }
    if (!config.groupTitle) {
      errors.push("Group title is required");
    }
    return errors;
  }
}

// Register this provider globally
if (typeof window.LiveTabGroupsProviders === "undefined") {
  window.LiveTabGroupsProviders = {};
}
window.LiveTabGroupsProviders["github-prs"] = new GitHubPRProvider();
