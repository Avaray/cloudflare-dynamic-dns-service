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
