import { test, expect, describe, afterEach, beforeEach } from "bun:test";
import { detectRuntime, isNewer } from "./cli";

describe("detectRuntime", () => {
    let originalBun: string | undefined;
    let originalDeno: any;
    let originalEnvSudoUser: string | undefined;
    let originalExecPath: string;

    beforeEach(() => {
        originalBun = process.versions.bun;
        originalDeno = (globalThis as any).Deno;
        originalEnvSudoUser = process.env.SUDO_USER;
        originalExecPath = process.execPath;
    });

    afterEach(() => {
        if (originalBun === undefined) {
            delete (process.versions as any).bun;
        } else {
            (process.versions as any).bun = originalBun;
        }
        
        if (originalDeno === undefined) {
            delete (globalThis as any).Deno;
        } else {
            (globalThis as any).Deno = originalDeno;
        }
        
        if (originalEnvSudoUser === undefined) {
            delete process.env.SUDO_USER;
        } else {
            process.env.SUDO_USER = originalEnvSudoUser;
        }

        Object.defineProperty(process, 'execPath', { value: originalExecPath, writable: true, configurable: true });
    });

    test("detects Node.js runtime correctly", () => {
        delete (process.versions as any).bun;
        delete (globalThis as any).Deno;
        Object.defineProperty(process, 'execPath', { value: "/usr/local/bin/node", writable: true, configurable: true });

        const rt = detectRuntime();
        expect(rt.engine).toBe("node");
        expect(rt.fullCommand).toBe("/usr/bin/env node");
        expect(rt.servicePrefix).toBe("/usr/bin/env node");
    });

    test("detects Bun runtime correctly", () => {
        (process.versions as any).bun = "1.0.0";
        delete (globalThis as any).Deno;
        Object.defineProperty(process, 'execPath', { value: "/home/user/.bun/bin/bun", writable: true, configurable: true });

        const rt = detectRuntime();
        expect(rt.engine).toBe("bun");
        expect(rt.fullCommand).toBe("/home/user/.bun/bin/bun");
    });

    test("detects Deno runtime correctly", () => {
        delete (process.versions as any).bun;
        (globalThis as any).Deno = { version: "1.37.0" };
        Object.defineProperty(process, 'execPath', { value: "/home/user/.deno/bin/deno", writable: true, configurable: true });

        const rt = detectRuntime();
        expect(rt.engine).toBe("deno");
        expect(rt.serviceArgs).toBe("run -A");
        expect(rt.fullCommand).toBe("/home/user/.deno/bin/deno run -A");
    });

    test("detects sudo environment", () => {
        process.env.SUDO_USER = "john";
        const rt = detectRuntime();
        expect(rt.isSudo).toBe(true);
        expect(rt.sudoUser).toBe("john");
    });
});

describe("isNewer", () => {
    test("returns false when versions are equal", () => {
        expect(isNewer("1.12.1", "1.12.1")).toBe(false);
        expect(isNewer("1.13.0", "1.13.0")).toBe(false);
    });

    test("returns false when local version is newer than remote (dev ahead of npm)", () => {
        expect(isNewer("1.12.1", "1.13.0")).toBe(false);
        expect(isNewer("1.0.0", "2.0.0")).toBe(false);
    });

    test("returns true when remote version is newer (update available)", () => {
        expect(isNewer("1.13.0", "1.12.1")).toBe(true);
        expect(isNewer("2.0.0", "1.99.99")).toBe(true);
        expect(isNewer("1.12.2", "1.12.1")).toBe(true);
    });

    test("handles v-prefix correctly", () => {
        expect(isNewer("v1.13.0", "1.12.1")).toBe(true);
        expect(isNewer("1.12.1", "v1.13.0")).toBe(false);
    });

    test("compares patch correctly", () => {
        expect(isNewer("1.12.2", "1.12.1")).toBe(true);
        expect(isNewer("1.12.1", "1.12.2")).toBe(false);
        expect(isNewer("1.12.10", "1.12.9")).toBe(true);
    });
});
