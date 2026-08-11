# **CDDS** ![](https://api.iconify.design/logos:cloudflare-icon.svg) Cloudflare Dynamic DNS Service

A lightweight [Dynamic DNS](https://en.wikipedia.org/wiki/Dynamic_DNS) (DDNS) client for [Cloudflare](https://cloudflare.com) users who want to use their own
[domains](https://en.wikipedia.org/wiki/Domain_name) for home-hosted services.

If your [ISP](https://en.wikipedia.org/wiki/Internet_service_provider) frequently changes your IP address, and you want to host services on your home network under a static domain name, **CDDS** is a tool for you. It runs efficiently in the background, checks your public [IPv4](https://en.wikipedia.org/wiki/IPv4) or [IPv6](https://en.wikipedia.org/wiki/IPv6) address, and automatically updates your Cloudflare [DNS records](https://en.wikipedia.org/wiki/Domain_Name_System) whenever your IP changes.

## 🚀 Features

- **Interactive [CLI](https://en.wikipedia.org/wiki/Command-line_interface) Setup Wizard:** Just type `cdds` in your terminal and answer a few simple questions. No manual editing of configuration files is required.
- **Service Manager Integrations:** Built-in tools to easily manage the DDNS background service depending on your operating system:
  - **Native Daemon Mode:** Runs in the background (no extra tools required).
  - **[Systemd Service](https://en.wikipedia.org/wiki/Systemd):** Native Linux background service integration (requires `sudo`).
  - **[Windows Task Scheduler](https://en.wikipedia.org/wiki/Windows_Task_Scheduler):** Sets itself up to run automatically as soon as Windows starts or you log in (requires Administrator rights).
  - **[Launchd](https://en.wikipedia.org/wiki/Launchd):** It uses LaunchDaemon on macOS to start the service in the background (requires `sudo`).
  - **[PM2](https://pm2.keymetrics.io/):** Node.js ecosystem process manager integration.
- **Smart DNS Management:**
  - **Dual-Stack Support:** Choose between `ipv4` (A records), `ipv6` (AAAA records), or `both` simultaneously.
  - Auto-discovers Cloudflare Zone IDs.
  - Auto-detects your API credential type (Global Key vs Scoped Token).
  - Multi-target support (update multiple subdomains at once).

## 📋 Requirements

- A JavaScript runtime: [Node.js](https://nodejs.org/) (v18+), [Bun](https://bun.sh/), or [Deno](https://deno.com/).
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) with a domain added.
- A Cloudflare [API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) (recommended) or a [Global API key](https://developers.cloudflare.com/fundamentals/api/get-started/keys/).

## 📦 Installation

To get started, install the package globally using your preferred package manager:

```sh
# using NPM
npm install -g cloudflare-dynamic-dns-service

# using PNPM
pnpm install -g cloudflare-dynamic-dns-service

# using Bun
bun install -g cloudflare-dynamic-dns-service

# using Deno
deno install -g npm:cloudflare-dynamic-dns-service
```

## 🛠️ Usage

After installation, simply run the interactive CLI in your terminal:

```sh
cdds
```

### CLI Menu Options
When you run `cdds`, you will be greeted by an interactive menu with the following options:

1. **Run .env Configuration Wizard** — a step-by-step wizard to input your Cloudflare credentials, target subdomains, proxy status, IP type, and check interval.
2. **Edit existing .env Configuration** — modify your existing setup without manually editing files.
3. **Manage Daemon (built-in)** — start, stop, or reload the native background process (works on all platforms without additional tools).
4. **Manage Launchd Service (macOS)** — install and manage a system LaunchDaemon that starts at boot; requires `sudo`.
5. **Manage Windows Task Scheduler** — install and manage a scheduled task that starts at boot; requires Administrator privileges.
6. **Manage Systemd Service** — install and manage a Systemd unit; requires `sudo`; only shown on Linux systems with Systemd.
7. **Manage PM2 Service** — install and manage a PM2 process; only shown when `pm2` is available in `PATH`.

### Commands

| Command          | Description                                                      |
| ---------------- | ---------------------------------------------------------------- |
| `cdds`           | Open interactive UI (configuration wizard + service manager)     |
| `cdds start`     | Run the DDNS updater in the **foreground** (blocks terminal)     |
| `cdds daemon`    | Run the DDNS updater in the **background** (detached process)    |
| `cdds stop`      | Stop the background daemon                                       |
| `cdds status`    | Check if the background daemon is currently running              |
| `cdds upgrade`   | Check for updates and optionally run an in-place upgrade         |
| `cdds version`   | Print the current version (aliases: `--version`, `-v`)           |
| `cdds help`      | Show help message (aliases: `--help`, `-h`)                      |


## ⚙️ Configuration

CDDS relies on environment variables for configuration. You can provide these by exporting them in your shell (e.g. `.bashrc`), or by placing them in a configuration file (by default, a `.env` file in the current directory).

> **💡 Custom Config File:** You can use any filename or extension for your configuration file (e.g., `/etc/cdds.conf`). Just point to it using the `CDDS_ENV_PATH` variable. CDDS will seamlessly read from and write to that file.

> **💡 Priority Rule:** System environment variables (like those exported in `.bashrc` or set by systemd) **always take precedence** over values defined in the `.env` file. The `.env` file simply acts as a fallback for missing values.

### Environment Variables

| Variable | Description |
| :--- | :--- |
| **`CDDS_API_KEY`** | Cloudflare API key or token (Auto-detected based on length/format). |
| **`CDDS_EMAIL`** | Cloudflare account email (only required if using Global API key). |
| **`CDDS_TARGETS`** | Domains to update (comma separated, e.g., `web.example.com,api.example.com`). |
| **`CDDS_ZONE_ID`** | Cloudflare zone ID. Auto-discovered if left empty. |
| **`CDDS_TTL`** | DNS record TTL in seconds (default `60`). |
| **`CDDS_CHECK_INTERVAL`** | Check interval in minutes (default `5`). |
| **`CDDS_IP_TYPE`** | IP type to update: `ipv4`, `ipv6`, or `both` for dual-stack (default `ipv4`). |
| **`CDDS_LOGS`** | Enable logging to console (`true`/`false`, default `true`). |
| **`CDDS_IP_LOGFILE`** | Enable IP change logging to `cdds-ip.log` (`true`/`false`). |
| **`CDDS_ACTION_LOGFILE`** | Enable full daemon action logging to `cdds-actions.log` (`true`/`false`). |
| **`CDDS_PROXIED`** | Enable Cloudflare proxy (orange cloud) (`true`/`false`, default `false`). |
| **`CDDS_ENV_PATH`** | Override configuration file location. Can be any file name/extension. Defaults to `.env` in the current directory. |
| **`CDDS_LOGS_DIR`** | Override directory where logs and `.pid` files are saved. Defaults to the config file directory. |

### Example Configurations

**Minimal Configuration** (using an API Token and relying on defaults):
```sh
CDDS_API_KEY=YOUR_CLOUDFLARE_API_TOKEN
CDDS_TARGETS=home.yourdomain.com
```

**Full Configuration** (with all options customized):
```zsh
CDDS_API_KEY=YOUR_CLOUDFLARE_GLOBAL_API_KEY
CDDS_EMAIL=your_email@example.com
CDDS_TARGETS=web.example.com,api.example.com
CDDS_ZONE_ID=023e105f4ecef8ad9ca31a8372d0c353
CDDS_TTL=120
CDDS_CHECK_INTERVAL=10
CDDS_IP_TYPE=both
CDDS_LOGS=true
CDDS_IP_LOGFILE=true
CDDS_ACTION_LOGFILE=true
CDDS_PROXIED=true
CDDS_LOGS_DIR=/var/log/cdds
```

## 📜 Changelog
All notable changes to this project are documented in the [CHANGELOG.md](CHANGELOG.md) file.

## 📝 License
This project is licensed under the [MIT License](LICENSE)
