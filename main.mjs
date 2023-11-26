import gip from 'gip';
import {setTimeout} from 'node:timers/promises'

import Package from './package.json' assert { type: "json" };

console.log(`Starting Cloudflare Dynamic DNS Service (version ${Package.version})`);

console.log(`Loading configs`);

import Config from './config.json' assert { type: "json" };

const config = {
  ip: null,
  ipLastCheck: 0,
  ipCheckIsRunning: false,
  subdomains: {},
  ...((({ subdomains, ...everything }) => everything)(Config))
}

Config.subdomains.forEach(subdomain => {
  config.subdomains[`${subdomain}.${config.domain}`] = {
    ip: '',
    id: '',
    updateIsRunning: false,
  }
})

for (let i = 0, done = false; done !== true; i++) {
  config.ip = await gip();
  if (config.ip) {
    done = true;
    (i === 0) ?
    console.log(`You are connected to internet and your IP address is ${config.ip}`):
      console.log(`Found external IP address after ${i} retr${i >= 2 ? 'ies' : 'y'}`);
  } else {
    i === 0 && process.stdout.write(`Waiting for internet connection`);
    await setTimeout(5000);
  }
}

const apiUrlGetAllDnsRecords = `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records`;
const apiUrlUpdateAddRecord = (recordId = '') => `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records/${recordId}`;
const bodyUpdateId = (name) => ({ 'content': config.ip, 'name': name, 'proxied': false, 'type': 'A', 'comment': 'Updated IP', 'tags': [], 'ttl': config.ttl })
const headersToken = { 'Authorization': `Bearer ${config.key}` }
const headersGlobalKey = { 'X-Auth-Email': config.email, 'X-Auth-Key': config.key }

const fetchOptions = (method = 'GET', name = '') => ({
  method: String(method).toUpperCase(),
  headers: {
    'Content-Type': 'application/json',
    ...(config.keyType === 'token' && headersToken),
    ...(config.keyType === 'key' && headersGlobalKey),
  },
  ...(method !== 'GET' && { body: bodyUpdateId(name) })
})

// 
const getDnsRecords = async (errors = 0) => {
  try {
    const response = await fetch(apiUrlGetAllDnsRecords, fetchOptions('GET'));
    !response.success && errors++ && Throw (`Error getting DNS records list (${errors >= 2 && `${errors} tries`})`);
    return await response.json();
  } catch (error) {
  }
  if (errors > 0) setTimeout(5000);
};

console.log(`Trying to get existing DNS records list`);

const dnsRecordsFound = await getDnsRecords();

// console.log(dnsRecordsFound.success);

let dnsRecordsErrors = 0;

if (!dnsRecordsFound.success) {
  dnsRecordsErrors++;
  console.log(`Error getting DNS records list (${dnsRecordsErrors >= 2 && `${dnsRecordsErrors} tries`})`);
}


if (dnsRecordsFound.success && dnsRecordsFound.result.length >= 1) {
  console.log(`Found ${dnsRecordsFound.result.length} record${dnsRecordsFound.result.length > 1 ? 's' : ''}`);
} else {
  console.log(`No records found`);
}

// console.log(`Looking for ${Object.keys(config.subdomains).length} subdomains in ${dnsRecordsFound.result.length}`);

process.exit()

Object.keys(config.subdomains).forEach(subdomain => {
  const match = dnsRecordsFound.result.find(record => record.name === subdomain);
  if (match) {
    console.log(`Found ${subdomain} in DNS records`);
    config.subdomains[subdomain].id = match.id;
    config.subdomains[subdomain].ip = match.content;
  }
})

process.exit()

// This function will create DNS record for subdomain
const createRecord = async (name) => {
  console.log(`Trying to create DNS record for ${name}`);
  const response = await fetch(apiUrlAddRecord, fetchOptions('PUT', name));
  console.log(await response.json());
  // return response.json();
}

Object.keys(config.subdomains).forEach(async (subdomain) => {
  if (!config.subdomains[subdomain].id) {
    console.log(`Subdomain ${subdomain} not found in DNS records`);
    const response = await createRecord(subdomain);
    // console.log(response);
  }
})


process.exit()

// This function updates record with specific ID
const updateID = async (id) => {
  const response = await fetch(apiUrlUpdateAddRecord(id), fetchOptions('PUT'));
  return response.json();
}

// Calculate time from last IP check
const ipCheckTimeDiff = (date1 = 0, date2 = Date.now()) => Math.floor(Math.abs(date1 - date2) / 1000);
