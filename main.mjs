import Package from './package.json' assert { type: "json" };

console.log(`Starting Cloudflare Dynamic DNS Service (version ${Package.version})`);

import Config from './config.json' assert { type: "json" };

const config = {
  ip: '',
  ipLastCheck: 0,
  ipCheckIsRunning: false,
  ...Config
}

config.subdomains = {}

Config.subdomains.forEach(subdomain => {
  config.subdomains[`${subdomain}.${config.domain}`] = {
    ip: '',
    id: '',
    updateIsRunning: false,
  }
})

const apiUrlGetAllDnsRecords = `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records`;
const apiUrlUpdateRecord = (recordId) =>  `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records/${recordId}`;
const apiUrlAddRecord = `https://api.cloudflare.com/client/v4/zones/${config.zoneId}/dns_records`;
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

const getDnsRecords = async () => {
  const response = await fetch(apiUrlGetAllDnsRecords, fetchOptions('GET'));
  return await response.json();
};

console.log(`Trying to get existing DNS records list`);

const dnsRecordsFound = await getDnsRecords();

console.log(dnsRecordsFound);

process.exit()


if (dnsRecordsFound.result.success && dnsRecordsFound.result.length >= 1) {
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
  const response = await fetch(apiUrlUpdateRecord(id), fetchOptions('PUT'));
  return response.json();
}

// Calculate time from last IP check
const ipCheckTimeDiff = (date1 = 0, date2 = Date.now()) => Math.floor(Math.abs(date1 - date2) / 1000);
