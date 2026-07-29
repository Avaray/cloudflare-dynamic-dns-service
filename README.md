# **CDDS** ![](https://api.iconify.design/logos:cloudflare-icon.svg) Cloudflare Dynamic DNS Service

**WARNING** - This script is still in development.

Created for [Cloudflare](https://cloudflare.com) users who want to use their own
[subdomains](https://en.wikipedia.org/wiki/Subdomain) (or
[domains](https://en.wikipedia.org/wiki/Domain_name)) for dynamic DNS.

It is slightly more complex alternative to services like
[No-IP](http://www.noip.com/), [Dynu](http://www.dynu.com/),
[CouDNS](https://www.cloudns.net/), etc. It will be useful when you don't have a
static IP address (when your
[ISP](https://en.wikipedia.org/wiki/Internet_service_provider) changes it
frequently), and you would like to always connect to the same address. It will
monitor your external IP address and update your Cloudflare DNS records
automatically.

## Requirements

- [Deno](https://docs.deno.com/runtime/getting_started/installation/) or
  [Bun](https://bun.com/docs/installation) as your JavaScript runtime.
- [Cloudflare account](https://dash.cloudflare.com/sign-up) with
  [added website](https://developers.cloudflare.com/fundamentals/setup/account-setup/add-site/)
  and
  [API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
  or
  [Global API key](https://developers.cloudflare.com/fundamentals/api/get-started/keys/).
- Any process manager (like [PM2](https://pm2.keymetrics.io/) or
  [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html))
  if you want to run it for a long time.

## Installation

### Using [Bun](https://bun.sh/) (Recommended)

```sh
bun install
bun run main.ts
```

### Using Node.js

```sh
npm install
node main.ts
```

## Configuration

| Environment Variable    | Description                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **CDDS_API_KEY**        | Cloudflare API key or token (Auto-detected based on length/format).                                                                         |
| **CDDS_EMAIL**          | Cloudflare account email address (only required if using API key).                                                                          |
| **CDDS_TARGETS**        | Domains or subdomains to update (comma separated).                                                                                          |
| **CDDS_ZONE_ID**        | Cloudflare zone ID where domains will be added/updated. If empty, it will be auto-discovered based on domain.                               |
| **CDDS_TTL**            | Cloudflare DNS record TTL in seconds (default `300`, minimum `60`).                                                                         |
| **CDDS_CHECK_INTERVAL** | Check interval in minutes (default 5).                                                                                                      |
| **CDDS_LOGS**           | Enable logging to console (`true` or `false`, default `true`).                                                                              |
| **CDDS_IP_LOGFILE**     | Enable IP logging. If `true`, new IP will be logged to `cdds.log` file in the current directory. You can specify path to directory or file. |

### Example configuration

```sh
CDDS_API_KEY=ada33c3hub7e14b593e180uuu734331131d65
CDDS_EMAIL=johndoe@example.com
CDDS_TARGETS=web.example.com,server.example.com
CDDS_ZONE_ID=802e9018cb3c1e9cb12360ec8442981d
CDDS_TTL=60
CDDS_CHECK_INTERVAL=1
CDDS_LOGS=true
CDDS_IP_LOGFILE=true
```

## Things to implement

- CLI with prompts for initial configuration (creating .env file).
- Publication to NPM.
