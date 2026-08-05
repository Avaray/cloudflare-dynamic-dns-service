# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.8.1] - 2026-08-06

### Changed
- **CLI Configuration Safety:** Options to start, reload, or install services across all built-in managers (PM2, Systemd, Launchd, Task Scheduler, Native Daemon) are now automatically disabled (dimmed) if the `.env` configuration file is invalid or missing required variables.
- **Documentation:** Clarified `.env` creation behavior in `README.md` and split configuration examples into "Minimal" and "Full" sections for better onboarding. Added a direct link to the changelog.

---

## [1.8.0] - 2026-08-05

### Added
- **`CDDS_LOGS_DIR` environment variable** — allows decoupling log and PID files from the `.env` configuration directory. This is especially useful for global system installs (e.g. storing `.env` in `/etc/cdds` and logs in `/var/log/cdds`). Can be passed as an environment variable or set directly inside the `.env` file itself.

### Changed
- **Enhanced `--env` path visibility in CLI** — if the CLI is started with a custom `--env` path that points to a non-existent or inaccessible file, the path is now explicitly displayed in the header with its status (`File does not exist`, `Permission denied`, or `Invalid configuration`).
- **Wizard auto-creates parent directories** — when completing the Configuration Wizard for a custom `--env` path that doesn't exist yet, the CLI will now automatically create all required parent directories before saving the `.env` file. It also elegantly catches file permission errors instead of crashing.

---

## [1.7.1] - 2026-08-05

### Added
- **`--env` / `-e` global flag** — specify a custom path to the `.env` configuration file directly from the command line (e.g. `cdds --env /srv/cdds/prod.env`); overrides `CDDS_ENV_PATH` and is available for all commands (`start`, `daemon`, `status`, interactive UI); the flag is stripped early so sub-commands are unaffected
- **Config path in main menu header** — when a valid configuration file is detected, its absolute path is now displayed in dimmed text below the app title in the interactive menu, making it immediately clear which config is active

### Fixed
- **Systemd Manager: incorrect `ExecStart` on global installs** — the generated `.service` file now uses the exact absolute path to the script (`bun /path/to/cli.js start --env /path/to/.env`) instead of `bun run cdds start`, which failed whenever the service was not started from the package directory; `CDDS_ENV_PATH` is also set in the `Environment=` line as a fallback
- **PM2 Manager: config path not embedded in `pm2.config.cjs`** — the generated PM2 config now passes `--env /absolute/path/.env` in `args` and sets `CDDS_ENV_PATH` in the `env` block, ensuring the correct config is loaded even when PM2 restarts the process from a different working directory
- **Launchd Manager: `--env` not propagated on install/reload** — the generated `.plist` `ProgramArguments` array now explicitly includes `--env` and the absolute path to the `.env` file as additional entries, so the daemon always loads the correct config after system reboots

### Style
- **Dimmed UI elements use `faint` instead of `dark gray`** — disabled menu items and secondary info text (e.g. config path, plist path) now use ANSI `\x1b[2m` (faint) instead of `\x1b[90m` (hard dark gray); this respects the terminal's native color scheme and is noticeably more readable on light and dark backgrounds

---

## [1.7.0] - 2026-08-05


### Added
- **macOS Launchd Manager** — new service manager for macOS, integrated into the main menu and the install wizard; supports Install & Start, Start, Stop, Reload, and Uninstall operations

### Changed
- **Launchd: LaunchAgent → LaunchDaemon** — migrated from per-user `~/Library/LaunchAgents` (requires active GUI session) to system-wide `/Library/LaunchDaemons`; the daemon now starts at boot, runs as root, and works fully in headless SSH / CI environments; requires `sudo` to install or manage
- **Service managers are now isolated** — each manager (Built-in Daemon, Systemd, PM2, Launchd, Task Scheduler) is now strictly self-contained and only manages its own service; the Built-in Daemon no longer scans the OS for external `cdds` processes or offers to kill them
- **Standardized menu UX across all managers** — all managers now show a consistent header with `Service: <name>` and `Status: <color-coded state>`; menu options (Start / Stop / Reload / Uninstall) appear or are hidden dynamically based on the actual current state
- **Systemd Manager now shows live status** — added `getSystemdStatus()` using `systemctl show -p LoadState,ActiveState,MainPID`; reports `Running (PID: X)`, `Stopped`, `Failed`, or `Not Installed` without crashing the CLI
- **PM2 Manager simplified** — now targets only the exact `Cloudflare-Dynamic-DNS-Service` process name; removed fuzzy cross-process scanning that could match unrelated services
- **Task Scheduler Manager simplified** — removed OS-wide scan for other similarly-named tasks; menu labels standardized to match other managers (`Install & Start Service`, `Stop Service`, `Start Service`, `Uninstall / Remove Service`)
- Launchd and Systemd menu entries show `(requires root)` and are disabled when not running as `sudo`

### Fixed
- **Launchd stop shows "Not Installed"** — after a `Stop Service` (`launchctl unload`) the status check now detects the plist file on disk and correctly reports `Stopped (unloaded)` instead of `Not Installed`; the `Start Service` option remains available without needing to reinstall

---

## [1.6.0] - 2026-08-05

### Added
- **`cdds version` command** — display the current version; also available as `cdds -v` and `cdds --version`; reads the version dynamically from `package.json`
- **"Save Services" option in PM2 Manager** — runs `pm2 save` under the hood, persisting the current process list so it is restored after system reboots (requires `pm2 startup` to be configured); shown whenever PM2 daemon is reachable

### Fixed
- **Console windows on Windows** — all `execSync` calls now include `windowsHide: true` via a wrapper, preventing `cmd.exe` / `conhost.exe` pop-ups when the CLI invokes system commands (e.g. `wmic`, `schtasks`, `powershell`, `pm2`)
- **PM2 new terminal window on start/reload** — PM2 config now uses the absolute path to the Bun/Node executable as `interpreter` and the absolute path to `cli.js` as `script`, instead of the `cdds` global wrapper command; this eliminates the `.cmd` shim that caused Windows to flash a new terminal window on every PM2 spawn
- **PM2 `module is not defined` ESM error** — renamed `pm2.config.js` to `pm2.config.cjs` to resolve the CommonJS/ESM conflict caused by `"type": "module"` in `package.json`
- **PM2 reload now re-applies full config** — "Reload" action regenerates `pm2.config.cjs` with fresh paths and calls `pm2 start` on it, so existing installations automatically receive the absolute-path fix without needing to reinstall

---

## [1.5.0] - 2026-08-03

### Added
- **`CDDS_ENV_PATH` environment variable** — set an absolute path to a custom `.env` file; all related files (`cdds.pid`, `cdds-actions.log`, `cdds-ip.log`, `cli-manager.log`, `pm2.config.js`) are stored in the same directory as the target `.env`, decoupling state from the CLI working directory
- **Kill external daemon from CLI** — the Built-in Daemon Manager now scans OS processes (via `wmic` on Windows, `ps` on Linux) and lists any other running CDDS daemon processes with their PIDs; a dedicated `Kill external daemon (PID: X)` menu option appears for each, with a confirmation step before sending `SIGTERM` / `taskkill /F`
- **Isolated instance-awareness per manager** — each service manager (PM2, Systemd, Task Scheduler, Built-in Daemon) independently detects other running instances of its own type and displays a yellow warning at the top of its menu
- **Reload Daemon** option added to the Windows Task Scheduler manager

### Changed
- **Unified service naming** across all managers:
  - PM2: `Cloudflare-Dynamic-DNS-Service`
  - Systemd: `cloudflare-dynamic-dns-service`
  - Windows Task Scheduler: `Cloudflare-Dynamic-DNS-Service` (unchanged)
- PM2 `cwd` and Systemd `WorkingDirectory` now resolve relative to `getLogDir()` instead of the CLI's `process.cwd()`
- Task Scheduler menu options (`Stop & Disable`, `Enable & Run Now`) are now **hidden** (not dimmed) when contextually irrelevant based on task status (`Running`, `Ready`, `Disabled`)
- Disabled item color in the select prompt softened from dim+gray to plain gray for better readability

### Fixed
- **Windows Terminal tab focus stealing** — spawning the built-in daemon in Git Bash inside Windows Terminal no longer switches the active tab; uses `Start-Process -WindowStyle Hidden` via PowerShell instead of `spawn` on Windows
- **Task Scheduler XML schema error** (`RestartInterval` unexpected node) — corrected XML structure to wrap restart settings in `<RestartOnFailure>`
- **Task Scheduler installation with spaces in paths** — exec path and script path are now properly quoted in the XML `<Command>` and `<Arguments>` nodes
- **Unrelated `.env` files** — CLI now validates that a `.env` file contains at least one `CDDS_` key before treating it as a CDDS config; unrelated files are ignored and the wizard is offered instead
- Non-CDDS environment variables in an existing `.env` are now preserved when the configuration wizard saves a new config

---

## [1.4.0] - 2026-08-02

### Added
- **Dual-Stack (IPv4 + IPv6) Support** — `CDDS_IP_TYPE` can now be set to `both`. The daemon will independently detect, manage, and update both `A` and `AAAA` records simultaneously for full dual-stack compatibility.
- **Strict IP Type Enforcement** — when `CDDS_IP_TYPE` is explicitly `ipv4` or `ipv6`, the daemon actively prevents split-DNS by deleting the opposite record type during every update cycle, even if the primary record requires no update.
- **Reload Daemon** option in the Daemon Manager — restarts the running daemon with the latest `.env` configuration without manual stop/start
- **Action file logging** (`CDDS_ACTION_LOGFILE`) — logs all daemon actions to `cdds-actions.log` with ISO timestamps and ANSI-stripped output
- Emoji prefixes on all non-interactive console output for improved readability

### Changed
- Configuration wizard now asks about the **Cloudflare Proxy** setting before logging options
- Logging questions are grouped at the end of the wizard under a master toggle:
  1. Enable logging? (master Yes/No)
  2. Log to terminal (console)?
  3. Log actions to file (`cdds-actions.log`)?
  4. Log IP changes to file (`cdds-ip.log`)?
- **"Press Enter to continue"** prompt replaced with a silent 1.5s auto-continue timeout after actions in the Daemon Manager

---

## [1.3.0] - 2026-07-31

### Added
- **Post-wizard action menu** — after saving the `.env` file the user is presented with three options: Install as a service, Run temporarily (built-in daemon), or Return to main menu

### Changed
- Replaced the `ink` / React-based interactive CLI (`cli.tsx`) with a zero-dependency implementation (`cli.ts`) using only the Node.js built-in `readline` module
  - Removed dependencies: `ink`, `react`, `ink-select-input`, `ink-text-input`, `@types/react`
  - Custom `selectPrompt` with arrow-key navigation and `textPrompt` with readline input
- Added additional NPM keywords to `package.json` for better discoverability

### Fixed
- CLI crash when transitioning from a text prompt to a select prompt — `stdin` was left paused after `textPrompt` closed its readline interface; fixed by explicitly calling `stdin.resume()` and adding a `null` guard on the keypress event

---

## [1.2.0] - 2026-07-30

### Added
- **IPv4/IPv6 conflict resolution** — when a new DNS record is created, any existing record of the opposite type (A vs AAAA) for the same hostname is automatically deleted to prevent split-DNS issues

### Fixed
- `CDDS_PROXIED` environment variable was not being parsed from `.env`, so the proxy (orange cloud) setting was always ignored
- DNS record was not updated when only the **proxied status** changed while the IP stayed the same
- `.env` file is now loaded automatically on startup without any external library — works across Node.js, Bun, and Deno
- Configuration wizard `SelectInput` fields now pre-select the currently saved value when editing an existing config
- NPM publish workflow fixed to support OIDC Trusted Publishing

### Performance
- Eliminated a redundant Cloudflare API call per update cycle — the DNS record is now fetched once and reused for both comparison and update, halving API requests per target

---

## [1.1.0] - 2026-07-30

### Added
- **IPv6 support** — new `CDDS_IP_TYPE` environment variable (`ipv4` / `ipv6`) controls whether the daemon manages `A` or `AAAA` records; uses the `gip` package for external IP detection
- Unit tests for `ipType` validation (`bun test`)
- `workflow_dispatch` trigger with optional version input for the CI/CD publish workflow

### Changed
- Package made fully compatible with **Node.js**, **Deno**, and **Bun** (cross-runtime entry point detection)
- `files` array added to `package.json` to exclude source files from the published NPM package
- CLI wizard boolean selects now use **Yes / No** labels instead of raw `true / false`
- README rewritten for NPM publication with updated installation and usage instructions

### CI/CD
- Added automated NPM publishing workflow via GitHub Actions

---

## [1.0.0] - 2026-07-29

Initial stable release after full rewrite from Deno to Bun.

### Added
- Interactive CLI (`cdds`) with an arrow-key menu
- **Configuration wizard** — guided setup that generates a `.env` file
- **Config editor** — edit an existing `.env` file from the CLI menu
- **Native background daemon mode** (`cdds start` / `cdds stop` / `cdds status`) with PID file management
- **Daemon Manager panel** in the CLI for controlling the built-in background daemon
- **Systemd service manager** (Linux) — install, start, stop, and uninstall a systemd unit
- **PM2 service manager** — install, stop, and remove a PM2-managed process
- **Windows Task Scheduler manager** — install, stop, enable, and remove a scheduled task; includes Administrator privilege check
- **Cloudflare Proxy (orange cloud)** toggle support via `CDDS_PROXIED`
- **Duplicate DNS record cleanup** — detects and removes stale duplicate records before updating
- Global `cdds` binary entrypoint via `package.json` `bin` field
- Package published to NPM as `cloudflare-dynamic-dns-service`

### Changed
- Migrated runtime from **Deno** to **Bun**
- Date/time formatting delegated to the `datr` package

### Removed
- All Docker-related configuration and references
