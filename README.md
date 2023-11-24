# **CDDS** 🌩 Cloudflare Dynamic DNS Service
The program constantly checks the external [IPv4 address](https://en.wikipedia.org/wiki/Internet_Protocol_version_4). When the address changes, the DNS entries in the [Cloudflare Zones](https://www.cloudflare.com/learning/dns/glossary/dns-zone/) will be updated using [Cloudflare API](https://developers.cloudflare.com/fundamentals/api/). The chosen domain/subdomain will point to your IP address.

Currently, the project is being created only for my personal use. I'm building it quickly to be able to connect to my [Raspberry Pi](https://www.raspberrypi.com/products/raspberry-pi-3-model-b-plus/) over the internet. I have plans to expand this project, but for now, I'm focusing on making it work for me.

# Requirements
- [**Cloudflare account**](https://dash.cloudflare.com/sign-up)
- [Added Website](https://developers.cloudflare.com/fundamentals/setup/account-setup/add-site/)
- [API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) or [Global API key](https://developers.cloudflare.com/fundamentals/api/get-started/keys/)
- Knowledge of [DNS Zone ID](https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/)
- [**Node.js**](https://nodejs.org/en/download) (version **18.0.0** or higher) and package manager like [PNPM](https://pnpm.io/) or [NPM](https://docs.npmjs.com/cli/)
- Any process manager (like [systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html) or [pm2](https://pm2.keymetrics.io/)), which will allow you to maintain a running program 
