import 'dotenv/config';
import gip from 'gip';
import { setTimeout } from 'node:timers/promises';
import { ValidateConfig } from './utils.mjs';

import Package from './package.json' assert { type: 'json' };

console.log(`Starting Cloudflare Dynamic DNS Service (version ${Package.version})`);

console.log(`Loading configs`);

const Config = {
  email: process.env.CDDS_EMAIL,
  key: process.env.CDDS_KEY,
  keyType: process.env.CDDS_KEY_TYPE,
  domain: process.env.CDDS_DOMAIN,
  subdomains: JSON.parse(process.env.CDDS_SUBDOMAINS),
  zoneId: process.env.CDDS_ZONE_ID,
  ttl: Number(process.env.CDDS_TTL),
  logs: JSON.parse(process.env.CDDS_LOGS),
};

const config = {
  ip: null,
  ipLastCheck: 0,
  ipCheckIsRunning: false,
  subdomains: {},
  ...(({ subdomains, ...everything }) => everything)(Config),
};

Config.subdomains.forEach((subdomain) => {
  config.subdomains[`${subdomain}.${config.domain}`] = {
    ip: '',
    id: '',
    updateIsRunning: false,
  };
});

console.log(`Checking configs`);
(await ValidateConfig(config)) && process.exit();
config.keyType.length === 0 && (config.keyType = 'token');

for (let i = 0, done = false; done !== true; i++) {
  config.ip = await gip();
  if (config.ip) {
    done = true;
    i === 0
      ? console.log(`You are connected to internet and your external IP address is ${config.ip}`)
      : console.log(`Found external IP address after ${i} retr${i >= 2 ? 'ies' : 'y'}`);
  } else {
    i === 0 && process.stdout.write(`Waiting for internet connection`);
    await setTimeout(5000);
  }
}

const apiUrlGetAllDnsRecords = `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records`;
const apiUrlUpdateAddRecord = (recordId = '') =>
  `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records/${recordId}`;
const bodyUpdateId = (name) => ({
  content: config.ip,
  name: name,
  proxied: false,
  type: 'A',
  comment: 'Updated IP',
  tags: [],
  ttl: config.ttl,
});
const headersToken = { Authorization: `Bearer ${config.key}` };
const headersGlobalKey = { 'X-Auth-Email': config.email, 'X-Auth-Key': config.key };

const fetchOptions = (method = 'GET', name = '') => ({
  method: String(method).toUpperCase(),
  headers: {
    'Content-Type': 'application/json',
    ...(config.keyType === 'token' && headersToken),
    ...(config.keyType === 'key' && headersGlobalKey),
  },
  ...(method !== 'GET' && { body: bodyUpdateId(name) }),
});

// moze tutaj nie dawac trycatcha?
const getDnsRecords = async (errors = 0) => {
  try {
    const response = await fetch(apiUrlGetAllDnsRecords, fetchOptions('GET'));
    !response.success && errors++ && Throw(`Error getting DNS records list (${errors >= 2 && `${errors} tries`})`);
    return await response.json();
  } catch (error) {}
};

for (let i = 0, done = false; done !== true; i++) {
  const dnsRecords = await getDnsRecords();
  if (dnsRecords.success && dnsRecords.result.length >= 1) {
    done = true;
    i === 0
      ? console.log(`Got ${dnsRecords.result.length} record${dnsRecords.result.length > 1 ? 's' : ''}`)
      : console.log(`Got DNS records list after ${i} retr${i >= 2 ? 'ies' : 'y'}`);
  } else {
    i === 0 &&
      process.stdout.write(
        `Trying to get DNS records list from Cloudflare using ${
          config.keyType === 'token' ? 'API Token' : 'Global API key'
        }`,
      );
    await setTimeout(5000);
  }
}

process.exit();

if (dnsRecordsFound.success && dnsRecordsFound.result.length >= 1) {
  console.log(`Found ${dnsRecordsFound.result.length} record${dnsRecordsFound.result.length > 1 ? 's' : ''}`);
} else {
  console.log(`No records found`);
}

// console.log(`Looking for ${Object.keys(config.subdomains).length} subdomains in ${dnsRecordsFound.result.length}`);

process.exit();

Object.keys(config.subdomains).forEach((subdomain) => {
  const match = dnsRecordsFound.result.find((record) => record.name === subdomain);
  if (match) {
    console.log(`Found ${subdomain} in DNS records`);
    config.subdomains[subdomain].id = match.id;
    config.subdomains[subdomain].ip = match.content;
  }
});

process.exit();

// This function will create DNS record for subdomain
const createRecord = async (name) => {
  console.log(`Trying to create DNS record for ${name}`);
  const response = await fetch(apiUrlAddRecord, fetchOptions('PUT', name));
  console.log(await response.json());
  // return response.json();
};

Object.keys(config.subdomains).forEach(async (subdomain) => {
  if (!config.subdomains[subdomain].id) {
    console.log(`Subdomain ${subdomain} not found in DNS records`);
    const response = await createRecord(subdomain);
    // console.log(response);
  }
});

process.exit();

// This function updates record with specific ID
const updateID = async (id) => {
  const response = await fetch(apiUrlUpdateAddRecord(id), fetchOptions('PUT'));
  return response.json();
};

// Calculate time from last IP check
const ipCheckTimeDiff = (date1 = 0, date2 = Date.now()) => Math.floor(Math.abs(date1 - date2) / 1000);
