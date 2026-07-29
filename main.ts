import gip from "gip";
import process from "node:process";

interface CloudflareConfig {
  apiKey: string;
  apiKeyType: "key" | "token";
  checkIntervalMinutes?: number;
  dryRun: boolean;
  email: string;
  ipLogFile?: string | boolean;
  logs: boolean;
  recordId?: string;
  targets: string[];
  ttl: number;
  zoneId: string;
}

interface TargetInfo {
  recordId?: string;
  target: string;
  zoneId: string;
}

interface DNSRecord {
  content: string;
  id: string;
  name: string;
  proxied: boolean;
  ttl: number;
  type: string;
}

interface CloudflareZone {
  id: string;
  name: string;
  paused: boolean;
  status: string;
}

interface CloudflareResponse {
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: DNSRecord | DNSRecord[];
  success: boolean;
}

interface CloudflareZoneResponse {
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: CloudflareZone[];
  success: boolean;
}

class CloudflareDDNS {
  private config: CloudflareConfig;
  private currentIP: string = "";
  private ipLogPath: string = "";
  private lastKnownIP: string = "";
  private targetInfos: TargetInfo[] = [];

  constructor(config: CloudflareConfig) {
    this.config = {
      checkIntervalMinutes: 5,
      ...config,
    };
    this.initializeIPLogging();
  }

  // Initialize IP logging path
  private initializeIPLogging(): void {
    if (!this.config.ipLogFile) {
      return;
    }

    try {
      if (this.config.ipLogFile === true) {
        this.ipLogPath = "cdds.log";
      } else if (typeof this.config.ipLogFile === "string") {
        this.ipLogPath = this.config.ipLogFile;
      }
    } catch (error) {
      if (this.config.logs) {
        console.error(
          `Error initializing IP logging: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.ipLogPath = "";
    }
  }

  // Log IP change to file
  private async logIPChange(newIP: string): Promise<void> {
    if (!this.ipLogPath) return;

    try {
      const now = new Date();
      const timeString = now.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const logEntry = `${timeString} > ${newIP}\n`;

      const file = Bun.file(this.ipLogPath);
      const existingContent = await file.exists() ? await file.text() : "";
      await Bun.write(this.ipLogPath, existingContent + logEntry);

      if (this.config.logs) {
        console.log(`IP change logged to file: ${timeString} > ${newIP}`);
      }
    } catch (error) {
      if (this.config.logs) {
        console.error(
          `Error logging IP change: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Get current external IP using gip
  private async getCurrentIP(): Promise<string> {
    try {
      const ip = await gip({
        ensure: 3
      });
      if (!ip) {
        throw new Error("Failed to retrieve IP address - GIP returned null");
      }
      return ip;
    } catch (error) {
      throw new Error(
        `Failed to get current IP: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Auto-discover zone ID from target domain
  private async getZoneId(target: string): Promise<string> {
    // First check if we already have cached zone ID for this target
    const cachedInfo = this.targetInfos.find((info) => info.target === target);
    if (cachedInfo && cachedInfo.zoneId) {
      return cachedInfo.zoneId;
    }

    // If global zone ID is provided, use it for all targets
    if (this.config.zoneId && this.config.zoneId.trim() !== "") {
      return this.config.zoneId;
    }

    if (this.config.logs) {
      console.log(`Auto-discovering zone ID for ${target}...`);
    }

    try {
      // Extract root domain from target
      const parts = target.split(".");

      // Try different combinations to find the zone
      for (let i = 1; i < parts.length; i++) {
        const testDomain = parts.slice(i).join(".");
        if (this.config.logs) {
          console.log(`Checking if zone exists for: ${testDomain}`);
        }

        const zoneId = await this.findZoneForDomain(testDomain);
        if (zoneId) {
          if (this.config.logs) {
            console.log(`Found zone ID for ${testDomain}: ${zoneId}`);
          }

          // Cache the zone ID for this target
          const existingInfo = this.targetInfos.find((info) => info.target === target);
          if (existingInfo) {
            existingInfo.zoneId = zoneId;
          } else {
            this.targetInfos.push({ target, zoneId });
          }

          return zoneId;
        }
      }

      throw new Error(
        `Could not find any Cloudflare zone for domain: ${target}`,
      );
    } catch (error) {
      throw new Error(
        `Zone ID discovery failed for ${target}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Find zone ID for a specific domain
  private async findZoneForDomain(domain: string): Promise<string | null> {
    try {
      const url = `https://api.cloudflare.com/client/v4/zones?name=${domain}`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Set authorization header based on API key type
      if (this.config.apiKeyType === "token") {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      } else {
        headers["X-Auth-Email"] = this.config.email;
        headers["X-Auth-Key"] = this.config.apiKey;
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        if (this.config.logs) {
          console.log(
            `API request failed for ${domain}: ${response.status} ${response.statusText}`,
          );
        }
        return null;
      }

      const data = (await response.json()) as CloudflareZoneResponse;

      if (!data.success) {
        if (this.config.logs && data.errors.length > 0) {
          console.log(
            `Zone API error for ${domain}: ${data.errors.map((e) => e.message).join(", ")}`,
          );
        }
        return null;
      }

      if (data.result.length > 0) {
        const zone = data.result[0];
        if (this.config.logs) {
          console.log(
            `Found zone: ${zone.name} (ID: ${zone.id}, Status: ${zone.status})`,
          );
        }
        return zone.id;
      }

      if (this.config.logs) {
        console.log(`No zone found for ${domain}`);
      }
      return null;
    } catch (error) {
      if (this.config.logs) {
        console.log(
          `Error checking zone for ${domain}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }

  // Get ALL DNS A records for a target (to check for duplicates)
  private async getAllDNSRecords(target: string): Promise<DNSRecord[]> {
    try {
      const zoneId = await this.getZoneId(target);
      const timestamp = Date.now();
      const url =
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records?name=${target}&type=A&_=${timestamp}`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache", // Force no cache
      };

      if (this.config.apiKeyType === "token") {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      } else {
        headers["X-Auth-Email"] = this.config.email;
        headers["X-Auth-Key"] = this.config.apiKey;
      }

      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      const data = (await response.json()) as CloudflareResponse;

      if (!data.success) {
        throw new Error(
          `Cloudflare API error: ${data.errors.map((e) => e.message).join(", ")}`,
        );
      }

      return (data.result as DNSRecord[]).filter((r) => r.name === target && r.type === "A");
    } catch (error) {
      if (this.config.logs) {
        console.error(
          `Error getting all DNS records for ${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return [];
    }
  }

  // Clean up duplicate records (keep only the most recent one)
  private async cleanupDuplicateRecords(
    target: string,
    records: DNSRecord[],
  ): Promise<DNSRecord | null> {
    if (records.length <= 1) {
      return records[0] || null;
    }

    if (this.config.logs) {
      console.log(`Found ${records.length} duplicate A records for ${target}:`);
      records.forEach((r) => console.log(`  - ID: ${r.id}, IP: ${r.content}`));
    }

    // Sort by ID to get consistent ordering
    records.sort((a, b) => a.id.localeCompare(b.id));

    const keepRecord = records[0]; // Keep the first one consistently
    const toDelete = records.slice(1);

    // Delete duplicates
    const zoneId = await this.getZoneId(target);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.apiKeyType === "token") {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    } else {
      headers["X-Auth-Email"] = this.config.email;
      headers["X-Auth-Key"] = this.config.apiKey;
    }

    for (const record of toDelete) {
      try {
        const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${record.id}`;
        
        if (this.config.dryRun) {
          console.log(`[DRY RUN] Would delete duplicate record: ${record.id} (IP: ${record.content})`);
        } else {
          await fetch(url, { method: "DELETE", headers });
          if (this.config.logs) {
            console.log(`Deleted duplicate record: ${record.id} (IP: ${record.content})`);
          }
        }
        
        // Add delay between deletions
        await this.sleep(1000);
      } catch (error) {
        if (this.config.logs) {
          console.error(`Error deleting duplicate record ${record.id}:`, error);
        }
      }
    }

    return keepRecord;
  }

  // Get DNS record from Cloudflare (with duplicate cleanup)
  private async getDNSRecord(target: string): Promise<DNSRecord | null> {
    try {
      // Get all A records for this target
      const records = await this.getAllDNSRecords(target);

      if (this.config.logs) {
        console.log(`Found ${records.length} A records for ${target}:`);
        records.forEach((r) => console.log(`  - ID: ${r.id}, IP: ${r.content}, TTL: ${r.ttl}`));
      }

      if (records.length === 0) {
        return null;
      }

      // If we have duplicates, clean them up
      const record = await this.cleanupDuplicateRecords(target, records);

      if (record) {
        // Cache the record ID for future use
        const existingInfo = this.targetInfos.find((info) => info.target === target);
        const zoneId = await this.getZoneId(target);
        if (existingInfo) {
          existingInfo.recordId = record.id;
          existingInfo.zoneId = zoneId;
        } else {
          this.targetInfos.push({ target, zoneId, recordId: record.id });
        }
      }

      return record;
    } catch (error) {
      if (this.config.logs) {
        console.error(
          `Error getting DNS record for ${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return null;
    }
  }

  // Create DNS record in Cloudflare (with duplicate check)
  private async createDNSRecord(
    target: string,
    newIP: string,
  ): Promise<boolean> {
    try {
      // First, check if a record already exists
      const existingRecord = await this.getDNSRecord(target);
      if (existingRecord) {
        if (this.config.logs) {
          console.log(
            `Record already exists for ${target}, updating instead of creating...`,
          );
        }
        return await this.updateDNSRecord(target, newIP);
      }

      // Ensure we have a zone ID for this target
      const zoneId = await this.getZoneId(target);

      const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`;

      const createData = {
        type: "A",
        name: target,
        content: newIP,
        ttl: this.config.ttl,
        proxied: false, // Set to true if you want Cloudflare proxy
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Set authorization header based on API key type
      if (this.config.apiKeyType === "token") {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      } else {
        headers["X-Auth-Email"] = this.config.email;
        headers["X-Auth-Key"] = this.config.apiKey;
      }

      if (this.config.dryRun) {
        console.log(`[DRY RUN] Would create DNS record: ${target} → ${newIP}`);
        return true;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(createData),
      });

      const data = (await response.json()) as CloudflareResponse;

      if (!data.success) {
        // Check if error is because record already exists
        const existsError = data.errors.some((e) =>
          e.message.toLowerCase().includes("already exists") ||
          e.code === 81057
        );

        if (existsError) {
          if (this.config.logs) {
            console.log(
              `Record already exists for ${target}, attempting to update...`,
            );
          }
          return await this.updateDNSRecord(target, newIP);
        }

        throw new Error(
          `Failed to create DNS record for ${target}: ${data.errors.map((e) => e.message).join(", ")}`,
        );
      }

      const newRecord = data.result as DNSRecord;

      // Cache the new record ID
      const existingInfo = this.targetInfos.find((info) => info.target === target);
      if (existingInfo) {
        existingInfo.recordId = newRecord.id;
        existingInfo.zoneId = zoneId;
      } else {
        this.targetInfos.push({ target, zoneId, recordId: newRecord.id });
      }

      if (this.config.logs) {
        console.log(`DNS record created successfully: ${target} → ${newIP}`);
      }
      return true;
    } catch (error) {
      if (this.config.logs) {
        console.error(
          `Error creating DNS record for ${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }

  // Update DNS record in Cloudflare
  private async updateDNSRecord(
    target: string,
    newIP: string,
  ): Promise<boolean> {
    try {
      // Always get the current record to ensure we have the correct ID
      const record = await this.getDNSRecord(target);
      if (!record) {
        if (this.config.logs) {
          console.log(
            `No existing record found for ${target}, creating new one...`,
          );
        }
        return await this.createDNSRecord(target, newIP);
      }

      const recordId = record.id;
      const zoneId = await this.getZoneId(target);

      const url = `https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records/${recordId}`;

      const updateData = {
        type: "A",
        name: target,
        content: newIP,
        ttl: this.config.ttl,
        proxied: false, // Set to true if you want Cloudflare proxy
      };

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      // Set authorization header based on API key type
      if (this.config.apiKeyType === "token") {
        headers["Authorization"] = `Bearer ${this.config.apiKey}`;
      } else {
        headers["X-Auth-Email"] = this.config.email;
        headers["X-Auth-Key"] = this.config.apiKey;
      }

      if (this.config.dryRun) {
        console.log(`[DRY RUN] Would update DNS record: ${target} → ${newIP}`);
        return true;
      }

      const response = await fetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify(updateData),
      });

      const data = (await response.json()) as CloudflareResponse;

      if (!data.success) {
        throw new Error(
          `Failed to update DNS record for ${target}: ${data.errors.map((e) => e.message).join(", ")}`,
        );
      }

      if (this.config.logs) {
        console.log(`DNS record updated successfully: ${target} → ${newIP}`);
      }
      return true;
    } catch (error) {
      if (this.config.logs) {
        console.error(
          `Error updating DNS record for ${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return false;
    }
  }

  // Verify DNS propagation (simplified check)
  private async verifyDNSUpdate(
    target: string,
    expectedIP: string,
    maxRetries: number = 5,
  ): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
      await this.sleep(2000); // Wait 2 seconds between checks

      const record = await this.getDNSRecord(target);
      if (record && record.content === expectedIP) {
        if (this.config.logs) {
          console.log(`DNS update verified: ${target} points to ${expectedIP}`);
        }
        return true;
      }

      if (this.config.logs) {
        console.log(
          `Waiting for DNS propagation for ${target}... (attempt ${i + 1}/${maxRetries})`,
        );
      }
    }

    if (this.config.logs) {
      console.log(
        `DNS verification timed out for ${target}, but update may still be processing`,
      );
    }
    return false;
  }

  // Utility function for sleeping
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Main update cycle for a single target
  private async performUpdateForTarget(target: string): Promise<void> {
    try {
      // Clear cached record ID to force fresh lookup
      const existingInfo = this.targetInfos.find((info) => info.target === target);
      if (existingInfo) {
        existingInfo.recordId = undefined;
      }

      // Get current DNS record (this will also clean up duplicates if found)
      const dnsRecord = await this.getDNSRecord(target);

      if (!dnsRecord) {
        if (this.config.logs) {
          console.log(
            `DNS record not found for ${target}, creating new record...`,
          );
        }
        const createSuccess = await this.createDNSRecord(
          target,
          this.currentIP,
        );
        if (!createSuccess) {
          if (this.config.logs) {
            console.error(`Failed to create DNS record for ${target}`);
          }
        } else {
          // Verify the record was created
          await this.verifyDNSUpdate(target, this.currentIP);
        }
        return;
      }

      const dnsIP = dnsRecord.content;
      if (this.config.logs) {
        console.log(`DNS record IP for ${target}: ${dnsIP}`);
      }

      // Check if update is needed
      if (this.currentIP === dnsIP) {
        if (this.config.logs) {
          console.log(`No update needed for ${target} - IP addresses match`);
        }
        return;
      }

      if (this.config.logs) {
        console.log(
          `IP address changed for ${target}: ${dnsIP} → ${this.currentIP}`,
        );
        console.log(`Updating DNS record for ${target}...`);
      }

      // Update DNS record
      const updateSuccess = await this.updateDNSRecord(target, this.currentIP);
      if (!updateSuccess) {
        if (this.config.logs) {
          console.error(`Failed to update DNS record for ${target}`);
        }
        return;
      }

      // Verify update
      await this.verifyDNSUpdate(target, this.currentIP);
    } catch (error) {
      if (this.config.logs) {
        console.error(
          `Error in update cycle for ${target}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Main update cycle for all targets
  private async performUpdate(): Promise<void> {
    try {
      if (this.config.logs) {
        console.log(`Checking current IP...`);
      }
      this.currentIP = await this.getCurrentIP();
      if (this.config.logs) {
        console.log(`Current external IP: ${this.currentIP}`);
      }

      // Check if IP changed and log it
      if (this.lastKnownIP && this.currentIP !== this.lastKnownIP) {
        await this.logIPChange(this.currentIP);
      }

      // Process each target
      for (const target of this.config.targets) {
        if (this.config.logs && this.config.targets.length > 1) {
          console.log(`Processing target: ${target}`);
        }
        await this.performUpdateForTarget(target);
      }

      this.lastKnownIP = this.currentIP;
    } catch (error) {
      if (this.config.logs) {
        console.error(
          `Error in update cycle: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Start the monitoring loop
  public async start(): Promise<void> {
    const intervalMinutes = this.config.checkIntervalMinutes!;
    if (this.config.logs) {
      console.log(
        `Starting Cloudflare DDNS service for ${this.config.targets.length} target${
          this.config.targets.length > 1 ? "s" : ""
        }`,
      );
      console.log(`Targets: ${this.config.targets.join(", ")}`);
      console.log(`Update interval: ${intervalMinutes} minutes`);
      console.log(`Zone ID: ${this.config.zoneId || "Auto-discover"}`);
      console.log(`API Key Type: ${this.config.apiKeyType} (Auto-detected)`);
      console.log(`TTL: ${this.config.ttl} seconds`);
      console.log(`Will auto-discover record IDs for each target`);
      console.log(`Logs: ${this.config.logs ? "Enabled" : "Disabled"}`);
      if (this.config.dryRun) {
        console.log(`Dry Run: Enabled (API calls will be bypassed)`);
      }
    }

    // Initial check on startup
    await this.performUpdate();

    // Set up interval
    setInterval(async () => {
      if (this.config.logs) {
        console.log("─".repeat(50));
        console.log(`${new Date().toLocaleString()} - Running scheduled check`);
      }
      await this.performUpdate();
    }, intervalMinutes * 60 * 1000);

    // Keep the process running
    if (this.config.logs) {
      console.log(
        `Service started. Monitoring ${this.config.targets.length} target${
          this.config.targets.length > 1 ? "s" : ""
        } every ${intervalMinutes} minutes...`,
      );
      if (this.ipLogPath) {
        console.log(`IP Logging to file: ${this.ipLogPath}`);
      }
    }
  }
}

// Parse comma-separated targets from environment variable
function parseTargets(targetsString: string): string[] {
  if (!targetsString || targetsString.trim() === "") {
    return [];
  }
  return targetsString
    .split(",")
    .map((target) => target.trim())
    .filter((target) => target.length > 0);
}

// Configuration - Handle target parsing more explicitly
function getTargets(): string[] {
  // If CDDS_TARGETS is set and not empty, use it
  if (process.env.CDDS_TARGETS && process.env.CDDS_TARGETS.trim() !== "") {
    return parseTargets(process.env.CDDS_TARGETS);
  }

  // Final fallback to example domain
  return ["subdomain.yourdomain.com"];
}

// Parse IP log file configuration
function getIPLogFileConfig(): string | boolean | undefined {
  const envValue = process.env.CDDS_IP_LOGFILE;
  if (!envValue) {
    return undefined;
  }
  if (envValue.toLowerCase() === "true") {
    return true;
  }
  return envValue;
}

// Auto-detect API key type
function detectApiKeyType(key: string): "key" | "token" {
  if (/^[0-9a-f]{37}$/i.test(key)) {
    return "key";
  }
  return "token";
}

// Configuration
const config: CloudflareConfig = {
  apiKey: process.env.CDDS_API_KEY ?? "your_cloudflare_api_key_here",
  apiKeyType: detectApiKeyType(process.env.CDDS_API_KEY ?? "your_cloudflare_api_key_here"),
  checkIntervalMinutes: parseInt(process.env.CDDS_CHECK_INTERVAL ?? "5"),
  dryRun: typeof Bun !== "undefined" && Bun.argv.includes("--dry-run"),
  email: process.env.CDDS_EMAIL ?? "your_email@example.com",
  ipLogFile: getIPLogFileConfig(),
  logs: process.env.CDDS_LOGS?.toLowerCase() === "true",
  targets: getTargets(),
  ttl: parseInt(process.env.CDDS_TTL ?? "60"),
  zoneId: process.env.CDDS_ZONE_ID ?? "",
};

// Validate configuration
function validateConfig(config: CloudflareConfig): void {
  if (config.apiKeyType === "key") {
    if (!config.email || config.email === "your_email@example.com") {
      throw new Error(
        "Please set your Cloudflare email (CDDS_EMAIL environment variable) when using API key",
      );
    }
  }
  if (!config.apiKey || config.apiKey === "your_cloudflare_api_key_here") {
    throw new Error(
      "Please set your Cloudflare API key/token (CDDS_API_KEY environment variable)",
    );
  }
  if (
    !config.targets || config.targets.length === 0 ||
    config.targets.some((t) => t === "subdomain.yourdomain.com")
  ) {
    throw new Error(
      "Please set your target domain(s) (CDDS_TARGETS environment variable - comma-separated for multiple targets)",
    );
  }
  if (config.ttl < 60) {
    throw new Error("TTL must be at least 60 seconds");
  }
  if (config.checkIntervalMinutes! < 1) {
    throw new Error("Check interval must be at least 1 minute");
  }
}

// Export the class for CLI usage
export { CloudflareDDNS, detectApiKeyType, getTargets, validateConfig, type CloudflareConfig };

// Main execution
export async function startDaemon() {
  try {
    validateConfig(config);
    const ddnsService = new CloudflareDDNS(config);
    await ddnsService.start();
  } catch (error) {
    console.error(
      `Configuration error: ${error instanceof Error ? error.message : String(error)}`,
    );
    console.error(`\nEnvironment variables you can set:`);
    console.error(
      `CDDS_EMAIL=your_email@example.com (required for API key type)`,
    );
    console.error(`CDDS_API_KEY=your_api_key_or_token`);
    console.error(
      `CDDS_TARGETS=subdomain.domain.com,another.domain.com (comma-separated)`,
    );
    console.error(`CDDS_ZONE_ID=optional_zone_id`);
    console.error(`CDDS_TTL=300 (in seconds)`);
    console.error(`CDDS_LOGS=true`);
    console.error(`CDDS_CHECK_INTERVAL=5`);
    console.error(`CDDS_IP_LOGFILE=true (or path to directory/file)`);
    process.exit(1);
  }
}

if (import.meta.main) {
  await startDaemon();
}
