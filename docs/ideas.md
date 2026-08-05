# CDDS — Future Ideas

A collection of ideas for future development of the Cloudflare Dynamic DNS Service.

---

## B. Multi-Account Support (Profiles)

**Problem:** The current `.env` format is flat, making it impossible to cleanly define multiple Cloudflare accounts in a single config file. Users who manage domains across different accounts must run separate instances of CDDS.

**Proposed solution:** Migrate from `.env` to a `cdds.json` configuration file with a `profiles` array. Backward compatibility with `.env` would be preserved — if the app detects an old `.env`, it works as before and optionally offers automatic migration.

**Example configuration (`cdds.json`):**
```json
{
  "global": {
    "checkIntervalMinutes": 5,
    "ipType": "both",
    "logs": true
  },
  "profiles": [
    {
      "name": "My personal domains",
      "apiKeyType": "token",
      "apiKey": "TOKEN_1",
      "targets": ["go.dav.one", "home.dav.one"],
      "proxied": false,
      "ttl": 60
    },
    {
      "name": "Company account",
      "apiKeyType": "key",
      "apiKey": "GLOBAL_KEY_2",
      "email": "admin@company.com",
      "targets": ["vpn.company.com"],
      "proxied": true,
      "ttl": 300
    }
  ]
}
```

**How it works:**
- The configuration wizard would ask at the end: *"Do you want to add another Cloudflare account (another profile)? (y/n)"*
- The daemon would fetch the external IP once per interval, then iterate through all profiles — authenticating with each profile's own API key separately.
- The CLI manager would display a profile picker when editing configuration.

---

## D. Mini Web Dashboard

**Problem:** The terminal UI is great for setup, but checking live status requires SSH access. A lightweight local web panel would make monitoring much more accessible.

**Proposed solution:** A new `cdds dashboard` command (or a menu option) that starts a minimal web server on a configurable port (default `8080`).

**Technology stack:**
- **Backend:** Native `Bun.serve()` — no Express.js or other heavy frameworks needed. Just a few lines of code to serve the HTML and a small REST API (`/api/status`, `/api/force-update`, `/api/logs`).
- **Frontend:** A single `index.html` file for easy distribution (no build step required on the server). Styled with **TailwindCSS v4** via the `@tailwindcss/browser@4` CDN script — the new Rust-based JIT engine applies utility classes directly in the browser with no PostCSS or Vite configuration needed.

**Dashboard features:**
1. Display the current external IP address (both IPv4 and IPv6).
2. Show a card for each DNS target with the last successful update time and current DNS record IP.
3. **"Force Update"** button — triggers an immediate IP check and DNS update without waiting for the next interval.
4. Live log viewer (last N lines from `cdds-actions.log`).
5. Show which service managers are active (PM2, Systemd, Launchd, etc.) and their status.

---

## E. Auto-Updater

**Problem:** Users need to manually pull changes, reinstall dependencies, rebuild, and restart services whenever a new version of CDDS is released.

**Proposed solution:** A `cdds update` CLI command (also accessible from the interactive menu) that automates the entire update process.

**How it works:**
1. **Version check:** The CLI makes an HTTP request to the GitHub API (e.g., `https://api.github.com/repos/<user>/cdds/releases/latest`) and compares the latest release tag to the version in the local `package.json`.
2. **User prompt:** If a newer version is found, the user sees: *"New version v1.8.0 found. Update now? (y/n)"*.
3. **Automated update sequence:**
   - `git pull` — fetch the latest changes
   - `bun install` — install any new dependencies
   - `bun run build` — rebuild the CLI and daemon
4. **Service restart:** After a successful build, the updater detects which service managers are in use (Launchd, PM2, Systemd, Task Scheduler) and issues the appropriate restart command automatically so the background daemon picks up the new code without manual intervention.

**Optional:** A `cdds update --check` flag that only prints whether an update is available, without actually updating — useful for scripting and monitoring.
