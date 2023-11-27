# **CDDS** ![](https://api.iconify.design/logos:cloudflare-icon.svg) Cloudflare Dynamic DNS Service
This program is my slightly more complex alternative to services like [No-IP](http://www.noip.com/), [Dynu](http://www.dynu.com/), [CouDNS](https://www.cloudns.net/), etc. It can be useful when you don't have a static IP address, and you would like to always connect to the same address in situations like:
- You have a Raspberry Pi at home, and you want to connect to it while eating kebab in the city.
- You're hosting a game server on a machine, or you simply want to play an older cooperative game with friends that requires connecting through an IP. It's much simpler to provide an address like `play.domain.com` than an IPv4 address.

The program constantly checks the external [IPv4 address](https://en.wikipedia.org/wiki/Internet_Protocol_version_4). When the address changes, the DNS entries in the [Cloudflare Zones](https://www.cloudflare.com/learning/dns/glossary/dns-zone/) will be updated using [Cloudflare API](https://developers.cloudflare.com/fundamentals/api/). The chosen subdomains will point to your IP address.  

# Config
Config file is required. You can load config from given path or fetch from given URL. By default program is trying to load `config.json` from 


## Create new config file
If you have `cdds` installed globally you can create new config file with following command. It will create `config.json` file in your **C**urrent **W**orking **D**irectory.
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
cdds --cfg-pth "/home/username/configs/config.json"
```
## Load config file from URL
```bash
cdds --cfg-url "https://domain.com/directory/config.json"
```


# Example of `config.json` file
```js
{
  // (required) Email address associated with your account
  "email": "your@email.com",

  // (required) API key 
  "key": "y89qAiC3X1-3GG3MSo1PbB33Xjz3Rbfmi69-0j42",

  // (optional) API key type. For security reasons, "token" is the default value
  "keyType": "token",

  // (required) Domain to be used for subdomains
  "domain": "domain.com",

  // (required) List of subdomains you wan't to use with domain
  "subdomains": ["dynamic", "private"],

  // (required) Zone ID
  // https://developers.cloudflare.com/fundamentals/setup/find-account-and-zone-ids/
  "zoneId": "201d8018ui3c1f9cb81590ec8194784d",

  // (optional) TTL, one minute as default value
  // https://en.wikipedia.org/wiki/Time_to_live
  "ttl": 60
}
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
- Ipv4 is the only protocol supported
- Cloudflare have [1200 API calls limit](https://developers.cloudflare.com/fundamentals/api/reference/limits/) per 5 minutes

# Future plans
- Micropython port
- GUI app for Windows (and maybe Linux)
