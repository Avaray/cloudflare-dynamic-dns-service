# CDDS — Future Ideas

A collection of ideas for future development of the Cloudflare Dynamic DNS Service.

---

## Multi-Account Support (Profiles)

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

## Stripped CHANGELOG.md for Published Package

**Problem:** `CHANGELOG.md` grows over time. Including the full history in the NPM package adds unnecessary weight, especially since users only care about the latest changes in the installed version, and NPM forces the inclusion of root `CHANGELOG.md` regardless of the `files` array in `package.json`.

**Proposed solution:** Use NPM lifecycle hooks (`prepack` and `postpack`) to dynamically swap the changelog file during publication.

**How it works:**
1. A Node.js/Bun script (e.g., `scripts/trim-changelog.ts`) is created.
2. In `package.json`, hook it into `prepack`: `"prepack": "bun run build && bun run scripts/trim-changelog.ts --trim"`.
3. The `--trim` script reads the main `CHANGELOG.md`, finds the section matching the version in `package.json`, and extracts only that chunk.
4. It renames the original `CHANGELOG.md` to `.CHANGELOG.md.backup`.
5. It writes the stripped chunk to a new `CHANGELOG.md`.
6. NPM creates the tarball with the small `CHANGELOG.md`.
7. Hook into `postpack`: `"postpack": "bun run scripts/trim-changelog.ts --restore"`.
8. The `--restore` script deletes the stripped file and restores `.CHANGELOG.md.backup` to `CHANGELOG.md`.

This guarantees the published package contains only a fraction of the data, while the Git repository seamlessly retains the full history without any manual intervention.

---
