# **CDDS** ![](https://api.iconify.design/logos:cloudflare-icon.svg) Cloudflare Dynamic DNS Service

## Configuration

| Environment Variable    | Description                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **CDDS_API_KEY**        | Cloudflare API key or token.                                                                                                                |
| **CDDS_API_KEY_TYPE**   | Cloudflare API key type (key or token).                                                                                                     |
| **CDDS_EMAIL**          | Cloudflare account email address (only if using API key).                                                                                   |
| **CDDS_TARGET**         | Domain or subdomain to update.                                                                                                              |
| **CDDS_TARGETS**        | Domains or subdomains to update (comma separated, prioritized over CDDS_TARGET).                                                            |
| **CDDS_ZONE_ID**        | Cloudflare zone ID where domains will be added/updated. If empty, it will be auto-discovered based on domain.                               |
| **CDDS_TTL**            | Cloudflare DNS record TTL in seconds (default `300`, minimum `60`).                                                                         |
| **CDDS_CHECK_INTERVAL** | Check interval in minutes (default 5).                                                                                                      |
| **CDDS_LOGS**           | Enable logging to console (`true` or `false`, default `true`).                                                                              |
| **CDDS_IP_LOGFILE**     | Enable IP logging. If `true`, new IP will be logged to `cdds.log` file in the current directory. You can specify path to directory or file. |

<details>
  <summary>Example configuration</summary>
    CDDS_API_KEY=ada33c3hub7e14b593e180uuu734331131d65
    CDDS_API_KEY_TYPE=key
    CDDS_EMAIL=johndoe@example.com
    CDDS_TARGET=
    CDDS_TARGETS=web.example.com,server.example.com
    CDDS_ZONE_ID=802e9018cb3c1e9cb12360ec8442981d
    CDDS_TTL=60
    CDDS_CHECK_INTERVAL=1
    CDDS_LOGS=true
    CDDS_IP_LOGFILE=true
</details>

## Requirements

- [Deno](https://docs.deno.com/runtime/getting_started/installation/) or
  [Bun](https://bun.com/docs/installation) as your JavaScript runtime
- [Cloudflare account](https://dash.cloudflare.com/sign-up) with
  [added website](https://developers.cloudflare.com/fundamentals/setup/account-setup/add-site/)
  and
  [API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)
  or
  [Global API key](https://developers.cloudflare.com/fundamentals/api/get-started/keys/)
- Any process manager (like [PM2](https://pm2.keymetrics.io/) or
  [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html))
  if you want to run it for a long time

## Things to implement

- [ ] Remove CDDS_TARGET and use only CDDS_TARGETS
- [ ] Auto-detect type of API key (token or key)
