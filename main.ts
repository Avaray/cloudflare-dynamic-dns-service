import process from "node:process";
import "dotenv/config";
import gip from "gip";
import { setTimeout } from "node:timers/promises";
import { ValidateConfig } from "./utils.ts";
import Package from "./package.json" with { type: "json" };

// import Package from './package.json' assert { type: 'json' };
// console.log(`Starting Cloudflare Dynamic DNS Service (version ${Package.version})`);
console.log(`Starting ${Package.displayName} v${Package.version}`);

console.log(`Loading configs`);
import { ValidateConfig } from "./utils.ts";

const Config = {};

// pomyslec nad domyslnymi wartosciami dla kluczy, ktore nie sa wymagane.
try {
  Config.email = process.env.CDDS_EMAIL;
  Config.key = process.env.CDDS_KEY;
  Config.keyType = process.env.CDDS_KEY_TYPE;
  Config.domain = process.env.CDDS_DOMAIN;
  Config.subdomains = JSON.parse(process.env.CDDS_SUBDOMAINS);
  Config.zoneId = process.env.CDDS_ZONE_ID;
  Config.ttl = Number(process.env.CDDS_TTL);
  Config.logs = JSON.parse(process.env.CDDS_LOGS);
} catch (error) {
  console.log(
    `Can't read environment variables. Please check your environment variables or your .env file and restart the service.`,
  );
  process.exit();
}

const config = {
  ip: null,
  ipLastCheck: 0,
  ipCheckIsRunning: false,
  subdomains: {},
  ...(({ subdomains, ...everything }) => everything)(Config),
};

Config.subdomains.forEach((subdomain) => {
  config.subdomains[`${subdomain}.${config.domain}`] = {
    ip: "",
    id: "",
    updateIsRunning: false,
  };
});

console.log(`Checking configs`);
(await ValidateConfig(config)) && process.exit();
config.keyType.length === 0 && (config.keyType = "token");

for (let i = 0, done = false; done !== true; i++) {
  config.ip = await gip();
  if (config.ip) {
    done = true;
    i === 0
      ? console.log(`You are connected to internet and your external IP address is ${config.ip}`)
      : console.log(`Found external IP address after ${i} retr${i >= 2 ? "ies" : "y"}`);
  } else {
    i === 0 && process.stdout.write(`Waiting for internet connection`);
    await setTimeout(5000);
  }
}

const apiUrlGetAllDnsRecords = `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records`;

const apiUrlUpdateAddRecord = (recordId = "") => `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records/${recordId}`;

const bodyUpdateId = (name) => ({
  content: config.ip,
  name: name,
  proxied: false,
  type: "A",
  comment: "Updated IP",
  tags: [],
  ttl: config.ttl,
});
const headersToken = { Authorization: `Bearer ${config.key}` };
const headersGlobalKey = { "X-Auth-Email": config.email, "X-Auth-Key": config.key };

const fetchOptions = (method = "GET", name = "") => ({
  method: String(method).toUpperCase(),
  headers: {
    "Content-Type": "application/json",
    ...(config.keyType === "token" && headersToken),
    ...(config.keyType === "key" && headersGlobalKey),
  },
  ...(method !== "GET" && { body: JSON.stringify(bodyUpdateId(name)) }),
});

const getDnsRecords = async (errors = 0) => {
  try {
    const response = await fetch(apiUrlGetAllDnsRecords, fetchOptions("GET"));
    !response.success && errors++ && Throw(`Error getting DNS records list (${errors >= 2 && `${errors} tries`})`);
    return await response.json();
  } catch (error) {}
};

let dnsRecords = [];

for (let i = 0, done = false; done !== true; i++) {
  const dnsRecordsFound = await getDnsRecords();
  if (dnsRecordsFound.success && dnsRecordsFound.result.length > 0) {
    done = true;
    i === 0
      ? console.log(`Got ${dnsRecordsFound.result.length} record${dnsRecordsFound.result.length > 1 ? "s" : ""}`)
      : console.log(`Got DNS records list after ${i} retr${i >= 2 ? "ies" : "y"}`);
    dnsRecords = dnsRecordsFound.result;
  } else {
    i === 0 &&
      process.stdout.write(
        `Trying to get DNS records list from Cloudflare using ${config.keyType === "token" ? "API Token" : "Global API key"}`,
      );
    await setTimeout(5000);
  }
}

Object.keys(config.subdomains).forEach((subdomain) => {
  const match = dnsRecords.find((record) => record.name === subdomain);
  if (match) {
    console.log(`Found ${subdomain} in DNS records`);
    config.subdomains[subdomain].id = match.id;
    config.subdomains[subdomain].ip = match.content;
  }
});

const createRecord = async (name) => {
  console.log(`Trying to create DNS record for ${name}`);
  const response = await fetch(apiUrlUpdateAddRecord(), fetchOptions("POST", name));
  return await response.json();
};

const subdomains = Object.keys(config.subdomains);

for (const subdomain of subdomains) {
  if (!config.subdomains[subdomain].id) {
    console.log(`Subdomain ${subdomain} not found in DNS records`);

    if (config.keyType === "token") {
      console.log(`You have to set Global API key to create DNS record for ${subdomain}`);
      continue;
    } else {
      const response = await createRecord(subdomain);
    }
  }
}

console.log(`Cloudflare Dynamic DNS Service is running and waiting for IP address change`);

// jakos lepiej wylapywac bledy w tej funkcji. albo dac trycatch na calosc, albo...
(async function check() {
  const ip = "";

  try {
    ip = await gip();
  } catch (error) {}

  if (ip && ip !== config.ip) {
    console.log(`IP address changed from ${config.ip} to ${ip}`);
    config.ip = ip;
    for (const subdomain of subdomains) {
      if (config.subdomains[subdomain].id && config.subdomains[subdomain].ip !== ip) {
        console.log(`Updating ${subdomain} DNS record`);
        const response = await fetch(
          apiUrlUpdateAddRecord(config.subdomains[subdomain].id),
          fetchOptions("PUT", subdomain),
        );
        const json = await response.json();
        if (json.success) {
          config.subdomains[subdomain].ip = ip;
        }
      }
    }
  }
  await setTimeout(5000);
  check();
})();
