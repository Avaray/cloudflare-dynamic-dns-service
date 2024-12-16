# **CDDS** ![](https://api.iconify.design/logos:cloudflare-icon.svg) Cloudflare Dynamic DNS Service

This program is my **slightly more complex alternative** to services like [No-IP](http://www.noip.com/), [Dynu](http://www.dynu.com/), [CouDNS](https://www.cloudns.net/), etc. It can be useful **when you don't have a static IP address**, and you would like to always connect to the same address in situations like:

- You have a Raspberry Pi at home, and you want to connect to it while eating kebab in the city.
- You want to play an older cooperative game with friends that requires connecting through an IP. It's much simpler to provide an address like `play.domain.com` than an IPv4 address. No need to provide a new IP address for the next sessions.

The program constantly checks the external [IPv4 address](https://en.wikipedia.org/wiki/Internet_Protocol_version_4). When the address changes, the DNS entries in the [Cloudflare Zones](https://www.cloudflare.com/learning/dns/glossary/dns-zone/) will be updated using [Cloudflare API](https://developers.cloudflare.com/fundamentals/api/). The chosen subdomains will point to your IP address.

## [CLI](https://en.wikipedia.org/wiki/Command-line_interface) installation

[NPM](https://docs.npmjs.com/downloading-and-installing-packages-globally)

```bash
npm i -g cdds
```

[BUN](https://bun.sh/docs/cli/install#global-packages)

```bash
bun i -g cdds
```

[DENO](https://docs.deno.com/runtime/reference/cli/install/#global-installation)

```bash
deno i -g npm:cdds
```

[PNPM](https://pnpm.io/cli/add#--global--g)

```bash
pnpm add -g cdds
```

<!-- ## [CLI](https://en.wikipedia.org/wiki/Command-line_interface) usage without installation -->

# Config

By default `CDDS` is trying to load `.env` file from **C**urrent **W**orking **D**irectory.

## Create new config file

If you have `cdds` installed globally you can create new config file with following command. It will create `config.json` file in your CWD.

```bash
cdds init
```

You can also provide the exact path where the file should be created.

```bash
cdds init "/home/username/configs/"
```

<!-- ```bash
cdds init "/home/username/configs/" --interactive
``` -->

## Load config file from specific directory

```bash
cdds --cfg-path "/home/username/configs/config.json"
```

## Load config file from URL

```bash
cdds --cfg-url "https://domain.com/directory/config.json"
```

# Usage

You have several ways to use this program.

<!-- need to write them -->

# Requirements

- [**Cloudflare account**](https://dash.cloudflare.com/sign-up)
- [Added Website](https://developers.cloudflare.com/fundamentals/setup/account-setup/add-site/)
- [API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) or [Global API key](https://developers.cloudflare.com/fundamentals/api/get-started/keys/)
- Knowledge of [DNS Zone ID](https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/)
- [**Node.js**](https://nodejs.org/en/download) (version **18.0.0** or higher) and package manager like [PNPM](https://pnpm.io/) or [NPM](https://docs.npmjs.com/cli/)
- Any process manager (like [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) or [pm2](https://pm2.keymetrics.io/)), which will allow you to maintain a running program
- [Ports forwarded](https://en.wikipedia.org/wiki/Port_forwarding) to your machine.

# Limitations of this program

- [IPv4](https://en.wikipedia.org/wiki/Internet_Protocol_version_4) is the only protocol supported.
- Cloudflare has [1200 API calls limit](https://developers.cloudflare.com/fundamentals/api/reference/limits/) per 5 minutes.

<!-- # Future plans

- [Python](https://www.python.org/) port
- [Micropython](https://micropython.org/) port
- One of those:
  - [GUI](https://en.wikipedia.org/wiki/Graphical_user_interface) interfece for Windows and Linux using
    [Neutralino.JS + React](https://neutralino.js.org/docs/getting-started/using-frontend-libraries)
  - [GUI](https://en.wikipedia.org/wiki/Graphical_user_interface) app for Windows using
    [.Net WPF C#](https://learn.microsoft.com/en-us/visualstudio/get-started/csharp/tutorial-wpf?view=vs-2022#what-is-wpf) (need to create
    entire app from scratch) -->
