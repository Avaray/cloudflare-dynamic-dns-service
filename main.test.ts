import { describe, expect, test } from "bun:test";
import { detectApiKeyType, validateConfig, type CloudflareConfig } from "./main.ts";

describe("Cloudflare DDNS Utils", () => {
  test("detectApiKeyType detects Global Key properly", () => {
    // 37 hex characters
    const globalKey = "1234567890abcdef1234567890abcdef12345";
    expect(detectApiKeyType(globalKey)).toBe("key");
  });

  test("detectApiKeyType detects Token properly", () => {
    // Token is usually not exactly 37 hex characters
    const token = "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890_-";
    expect(detectApiKeyType(token)).toBe("token");

    const shortKey = "abcdef1234567890abcdef1234567890abcd"; // 36 chars
    expect(detectApiKeyType(shortKey)).toBe("token");
  });

  test("validateConfig passes valid token config", () => {
    const validConfig: CloudflareConfig = {
      apiKey: "some_valid_token",
      apiKeyType: "token",
      email: "your_email@example.com", // email can be ignored/default for token
      targets: ["test.example.com"],
      ttl: 300,
      zoneId: "",
      logs: false,
      dryRun: false,
      checkIntervalMinutes: 5,
    };
    
    // Should not throw
    expect(() => validateConfig(validConfig)).not.toThrow();
  });

  test("validateConfig fails if using global key without email", () => {
    const invalidConfig: CloudflareConfig = {
      apiKey: "1234567890abcdef1234567890abcdef12345",
      apiKeyType: "key",
      email: "your_email@example.com", // Default placeholder
      targets: ["test.example.com"],
      ttl: 300,
      zoneId: "",
      logs: false,
      dryRun: false,
      checkIntervalMinutes: 5,
    };
    
    expect(() => validateConfig(invalidConfig)).toThrow(
      "Please set your Cloudflare email (CDDS_EMAIL environment variable) when using API key"
    );
  });

  test("validateConfig fails with missing API key", () => {
    const invalidConfig: CloudflareConfig = {
      apiKey: "your_cloudflare_api_key_here", // Default placeholder
      apiKeyType: "token",
      email: "valid@example.com",
      targets: ["test.example.com"],
      ttl: 300,
      zoneId: "",
      logs: false,
      dryRun: false,
      checkIntervalMinutes: 5,
    };
    
    expect(() => validateConfig(invalidConfig)).toThrow(
      "Please set your Cloudflare API key/token"
    );
  });

  test("validateConfig fails with missing targets", () => {
    const invalidConfig: CloudflareConfig = {
      apiKey: "valid_key",
      apiKeyType: "token",
      email: "valid@example.com",
      targets: ["subdomain.yourdomain.com"], // Default placeholder
      ttl: 300,
      zoneId: "",
      logs: false,
      dryRun: false,
      checkIntervalMinutes: 5,
    };
    
    expect(() => validateConfig(invalidConfig)).toThrow(
      "Please set your target domain(s)"
    );
  });

  test("validateConfig passes with valid ipType", () => {
    const validConfigIpv4: CloudflareConfig = {
      apiKey: "some_valid_token",
      apiKeyType: "token",
      email: "valid@example.com",
      targets: ["test.example.com"],
      ttl: 300,
      zoneId: "",
      logs: false,
      dryRun: false,
      checkIntervalMinutes: 5,
      ipType: "ipv4"
    };
    expect(() => validateConfig(validConfigIpv4)).not.toThrow();

    const validConfigIpv6: CloudflareConfig = {
      ...validConfigIpv4,
      ipType: "ipv6"
    };
    expect(() => validateConfig(validConfigIpv6)).not.toThrow();
  });

  test("validateConfig fails with invalid ipType", () => {
    const invalidConfig = {
      apiKey: "some_valid_token",
      apiKeyType: "token",
      email: "valid@example.com",
      targets: ["test.example.com"],
      ttl: 300,
      zoneId: "",
      logs: false,
      dryRun: false,
      checkIntervalMinutes: 5,
      ipType: "invalid_type" // ts-ignore would be needed, but we cast to any for runtime test
    } as any;
    
    expect(() => validateConfig(invalidConfig)).toThrow(
      "IP Type must be either 'ipv4' or 'ipv6'"
    );
  });
});
