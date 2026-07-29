# **CDDS** ![](https://api.iconify.design/logos:cloudflare-icon.svg) Cloudflare Dynamic DNS Service

A lightweight, interactive Dynamic DNS (DDNS) client for [Cloudflare](https://www.cloudflare.com/).

If your [ISP](https://en.wikipedia.org/wiki/Internet_service_provider) frequently changes your dynamic IP address, and you want to host services on your home network under a static domain name, **CDDS** is a tool for you. It runs efficiently in the background, checks your public [IPv4 address](https://en.wikipedia.org/wiki/IPv4), and automatically updates your Cloudflare [DNS records](https://en.wikipedia.org/wiki/Domain_Name_System) whenever your IP changes.

## 🚀 Features

- **Interactive [CLI](https://en.wikipedia.org/wiki/Command-line_interface) Setup Wizard:** Zero manual `.env` file editing. Just type `cdds` and follow terminal UI to configure everything.
- **Service Manager Integrations:** Built-in tools to easily manage the DDNS background service depending on your operating system:
  - **Native Daemon Mode:** Run detached directly via Bun (no external tools required).
  - **[Windows Task Scheduler](https://en.wikipedia.org/wiki/Windows_Task_Scheduler):** Auto-installs and runs on system boot (Windows).
  - **[Systemd Service](https://en.wikipedia.org/wiki/Systemd):** Native Linux background service integration.
  - **[PM2](https://pm2.keymetrics.io/):** Node.js ecosystem process manager integration.
- **Smart DNS Management:**
  - Auto-discovers Cloudflare Zone IDs.
  - Auto-detects your API credential type (Global Key vs Scoped Token).
  - Multi-target support (update multiple subdomains at once).
  - Full support for Cloudflare's **Proxied (Orange Cloud)** status.

## 📋 Requirements

- [Bun](https://bun.sh/) installed on your machine.
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) with a domain added.
- A Cloudflare [API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) (recommended) or a Global API key.

## 📦 Installation

To get started, install the package globally using Bun:

```sh
bun install -g cloudflare-dynamic-dns-service
```

## 🛠️ Usage

After installation, simply run the interactive CLI in your terminal:

```sh
cdds
```

### CLI Menu Options
When you run `cdds`, you will be greeted by an interactive menu with the following features:
1. **Run .env Configuration Wizard**: A step-by-step wizard to input your Cloudflare credentials, target subdomains, proxy status, and check interval.
2. **Edit existing .env Configuration**: Modify your existing setup without manually editing files.
3. **Manage Service**: Depending on your platform, you'll see options to install `cdds` as a background service via **Built-in Daemon**, **Windows Task Scheduler**, **Systemd**, or **PM2**.

### Manual Mode
If you prefer not to use the interactive CLI or want to run the script inside a Docker container, you can bypass the UI by running:

```sh
cdds start
```
This command runs the updater directly in the foreground, using the `.env` file present in the current working directory.

## ⚙️ Configuration (.env)

The `cdds` CLI wizard generates a `.env` file for you automatically. However, if you prefer to manage it manually (e.g., for Docker), here is the reference:

| Environment Variable    | Description                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **CDDS_API_KEY**        | Cloudflare API key or token (Auto-detected based on length/format).                                                                         |
| **CDDS_EMAIL**          | Cloudflare account email address (only required if using Global API key).                                                                   |
| **CDDS_TARGETS**        | Domains or subdomains to update (comma separated, e.g., `web.example.com,api.example.com`).                                                 |
| **CDDS_ZONE_ID**        | Cloudflare zone ID where domains will be added/updated. If empty, it will be auto-discovered based on the target domain.                    |
| **CDDS_TTL**            | Cloudflare DNS record TTL in seconds (default `60`).                                                                                        |
| **CDDS_CHECK_INTERVAL** | Check interval in minutes (default `5`).                                                                                                    |
| **CDDS_LOGS**           | Enable logging to console (`true` or `false`, default `true`).                                                                              |
| **CDDS_IP_LOGFILE**     | Enable IP logging. If `true`, IP changes will be logged to the `cdds.log` file.                                                             |
| **CDDS_PROXIED**        | Enable Cloudflare proxy (orange cloud) for the DNS record (`true` or `false`, default `false`).                                             |

### Example `.env` file:

```env
CDDS_API_KEY=YOUR_CLOUDFLARE_API_TOKEN
CDDS_TARGETS=home.yourdomain.com
CDDS_TTL=60
CDDS_CHECK_INTERVAL=5
CDDS_LOGS=true
CDDS_IP_LOGFILE=true
CDDS_PROXIED=false
```

## 📝 License
MIT License
