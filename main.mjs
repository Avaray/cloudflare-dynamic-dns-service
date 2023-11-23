import gip from 'gip';

let ip, id;

const subdomain = 'go.dav.one'

const authEmail = 'deffqqq@gmail.com'
const authKey = 'ada47c6dcb7e14b593e380ddd434222131b53'

const zoneID = '501d9018cb3c1f9cb85760ec8107984c'
const apiUrlGetIds = `https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records`;
const apiUrlUpdateId = id =>  `https://api.cloudflare.com/client/v4/zones/${zoneID}/dns_records/${id}`;

const options = (method) => ({
  method: String(method).toUpperCase(),
  headers: {
    'Content-Type': 'application/json',
    'X-Auth-Email': authEmail,
    'X-Auth-Key': authKey,
  },
  ...(method === 'PUT' && { body: {'content':ip, 'name':'go', 'proxied':false, 'type':'A', 'comment':'Updated IP', 'tags':[], 'ttl':60} })
})

const getID = async () => {
  const response = await fetch(apiUrlGetIds, options('GET'));
  return response.json();
};

const updateID = async (id) => {
  const response = await fetch(apiUrlUpdateId(id), options('PUT'));
  return response.json();
}
try {
  const subdomains = await getID();
  id = subdomains.result.find(entry => entry.name === subdomain).id;
  if (!id) throw new Error('ID not found');
  console.log(`Found ID ${id}`);
} catch (error) {
  console.error(error);
  process.exit(1);
}

console.log(`Trying to update record`);

const response = await updateID(id);

response.success && console.log(`Subdomain ${subdomain} leads now to IP ${response.result.content}`);
