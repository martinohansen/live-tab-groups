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
    if (!r.ok) throw new Error(`GitHub /user ${r.status}`);
    const j = await r.json();
    return j.login;
  }

  // Fetch PR URLs from GitHub API
  async fetchUrls(config) {
    if (!config.token) {
      console.warn(`[${this.id}] No GitHub token configured`);
      return [];
    }

    console.log(`[${this.id}] Fetching username...`);
    const username = await this.getUsername(config);
    console.log(`[${this.id}] Username: ${username}`);

    const queries = Array.isArray(config.queries) ? config.queries : [config.query || config.queries];
    console.log(`[${this.id}] Processing ${queries.length} queries`);
    const allUrls = new Set();

    // Execute all queries and combine results
    for (const query of queries) {
      if (!query || !query.trim()) continue;

      const resolvedQuery = query.replace(/@me/g, username);
      const url = `https://api.github.com/search/issues?q=${encodeURIComponent(resolvedQuery)}&per_page=100`;

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
          const errorText = await r.text();
          console.error(`[${this.id}] GitHub API error for query "${query}": ${r.status} ${r.statusText}`);
          console.error(`[${this.id}] Response body:`, errorText);

          // If auth fails, this is critical
          if (r.status === 401 || r.status === 403) {
            console.error(`[${this.id}] ⚠️ Authentication failed! Token may be invalid or expired.`);
          }
          continue;
        }

        const j = await r.json();
        console.log(`[${this.id}] Query returned ${j.total_count} total results, ${j.items?.length || 0} items in this page`);

        // Keep only PRs
        const urls = (j.items || [])
          .filter(it => it.pull_request && it.html_url)
          .map(it => it.html_url);

        console.log(`[${this.id}] Found ${urls.length} PRs from this query`);
        urls.forEach(u => allUrls.add(u));
      } catch (error) {
        console.error(`[${this.id}] Error fetching query "${query}":`, error);
      }
    }

    console.log(`[${this.id}] ✓ Total unique PRs found: ${allUrls.size}`);
    return Array.from(allUrls);
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
