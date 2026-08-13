#!/usr/bin/env node
import process from 'process';
import { execSync as nodeExecSync, spawn } from 'child_process';
import { promises as fsPromises } from 'node:fs';
import { appendFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const execSync = (cmd: string, options: any = {}) => {
	return nodeExecSync(cmd, { windowsHide: true, ...options });
};
import * as readline from 'readline';

import datr from 'datr';
import { startDaemon, validateConfig, type CloudflareConfig, detectApiKeyType } from './main.ts';

const isWindows = process.platform === 'win32';

// Early --env and --debug detection
{
	const envIdx = process.argv.findIndex(a => a === '--env' || a === '-e');
	if (envIdx !== -1 && process.argv[envIdx + 1]) {
		process.env.CDDS_ENV_PATH = resolve(process.argv[envIdx + 1]);
	}
	
	const debugIdx = process.argv.findIndex(a => a === '--debug' || a === '-d');
	if (debugIdx !== -1) {
		process.env.CDDS_DEBUG = 'true';
	}
}

export const debugLog = (msg: string | Error) => {
	if (process.env.CDDS_DEBUG === 'true') {
		const text = msg instanceof Error ? (msg.stack || msg.message) : msg;
		console.log(`\x1b[90m[DEBUG] ${text}\x1b[0m`);
	}
};

// Early synchronous .env read — loads CDDS_LOGS_DIR (and other vars) before any
// module-level constants are computed, so getLogDir() returns the correct path
// even when the user has set CDDS_LOGS_DIR inside the .env file itself.
try {
	const { readFileSync: _rfs } = await import('fs');
	const _envPath = process.env.CDDS_ENV_PATH ? resolve(process.env.CDDS_ENV_PATH) : resolve(process.cwd(), '.env');
	for (const line of _rfs(_envPath, 'utf8').split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const eqIdx = trimmed.indexOf('=');
		if (eqIdx === -1) continue;
		const k = trimmed.slice(0, eqIdx).trim();
		const v = trimmed.slice(eqIdx + 1).trim();
		if (k && !(k in process.env)) process.env[k] = v;
	}
} catch {}

const getEnvPath = () => process.env.CDDS_ENV_PATH ? resolve(process.env.CDDS_ENV_PATH) : resolve(process.cwd(), '.env');
const getLogDir = () => process.env.CDDS_LOGS_DIR ? resolve(process.env.CDDS_LOGS_DIR) : dirname(getEnvPath());

// Lazy getter — evaluated at call time so CDDS_LOGS_DIR is always respected
const getPidFile = () => resolve(getLogDir(), 'cdds.pid');

export interface RuntimeInfo {
	engine: 'node' | 'bun' | 'deno';
	execPath: string;
	servicePrefix: string;
	serviceArgs: string;
	fullCommand: string;
	isSudo: boolean;
	sudoUser: string | null;
}

export function detectRuntime(): RuntimeInfo {
	const isSudo = !!process.env.SUDO_USER;
	const sudoUser = process.env.SUDO_USER || null;
	
	let engine: 'node' | 'bun' | 'deno' = 'node';
	if (typeof process.versions.bun !== 'undefined') {
		engine = 'bun';
	} else if (typeof (globalThis as any).Deno !== 'undefined') {
		engine = 'deno';
	}
	
	let execPath = process.execPath;
	try {
		execPath = require('fs').realpathSync(execPath);
	} catch (e) {
		// Ignore if realpath fails
	}
	
	if (engine === 'deno' && !execPath) execPath = 'deno';
	
	let servicePrefix = '';
	let serviceArgs = '';
	let fullCommand = execPath;
	
	if (engine === 'node') {
		servicePrefix = '/usr/bin/env node';
		fullCommand = servicePrefix;
	} else if (engine === 'deno') {
		serviceArgs = 'run -A';
		fullCommand = `${execPath} ${serviceArgs}`;
	} else if (engine === 'bun') {
		if (execPath.includes('node') || execPath.endsWith('node.exe')) {
			try {
				execPath = execSync(isWindows ? "where bun" : "which bun", { encoding: "utf8" }).toString().trim().split('\n')[0].trim();
			} catch {
				execPath = 'bun';
			}
		}
		fullCommand = execPath;
	}
	
	return { engine, execPath, servicePrefix, serviceArgs, fullCommand, isSudo, sudoUser };
}


export const parseVer = (v: string) => v.replace(/^v/, '').split('.').map(Number);
export const isNewer = (a: string, b: string): boolean => {
	const [aMaj, aMin, aPat] = parseVer(a);
	const [bMaj, bMin, bPat] = parseVer(b);
	if (aMaj !== bMaj) return aMaj > bMaj;
	if (aMin !== bMin) return aMin > bMin;
	return aPat > bPat;
};

const fileExists = async (path: string) => { try { await fsPromises.access(path); return true; } catch { return false; } };

const logMessage = (msg: string) => {
	const line = `[${datr({ precision: 'ms', separator: '-' })}] ${msg}\n`;
	try { appendFileSync(resolve(getLogDir(), 'cli-manager.log'), line); } catch (e) {}
};

// Console UI Helpers (Zero Dependencies)
const clearScreen = () => {
	process.stdout.write('\x1Bc');
};

const textPrompt = (question: string, defaultValue: string = '', allowSaveAction: boolean = false): Promise<string> => {
	return new Promise((resolve, reject) => {
		process.stdout.write('\x1B[2J\x1B[0;0H'); // Clear and move to top
		console.log(`\x1b[36m\x1b[1m${question}\x1b[0m`);
		if (allowSaveAction) console.log(`\x1b[90m(Press Ctrl+S to save immediately and return)\x1b[0m\n`);
		else console.log();
		
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		
		const onKeyPress = (str: string, key: any) => {
			if (allowSaveAction && key && key.ctrl && key.name === 's') {
				process.stdin.removeListener('keypress', onKeyPress);
				rl.close();
				reject(new Error('SAVE_AND_RETURN'));
			}
		};
		process.stdin.on('keypress', onKeyPress);
		
		rl.question(`\x1b[32m❯\x1b[0m ${defaultValue ? `[${defaultValue}] ` : ''}`, (answer) => {
			process.stdin.removeListener('keypress', onKeyPress);
			rl.close();
			resolve(answer.trim() || defaultValue);
		});
	});
};

type SelectItem = { label: string; value: string; disabled?: boolean };
const selectPrompt = (question: string, items: SelectItem[], defaultIndex: number = 0, allowSaveAction: boolean = false): Promise<string> => {
	return new Promise((resolve, reject) => {
		// If the default index lands on a disabled item, find the first enabled one
		const firstEnabled = items.findIndex((item) => !item.disabled);
		let selectedIndex = items[defaultIndex]?.disabled ? (firstEnabled >= 0 ? firstEnabled : 0) : defaultIndex;
		let rl: readline.Interface | null = null;
		
		const renderMenu = () => {
			process.stdout.write('\x1B[2J\x1B[0;0H'); // Clear and move to top
			console.log(`\x1b[36m\x1b[1m${question}\x1b[0m`);
			if (allowSaveAction) console.log(`\x1b[90m(Press Ctrl+S to save immediately and return)\x1b[0m\n`);
			else console.log();
			items.forEach((item, index) => {
				if (item.disabled) {
					// Dark gray — visually unavailable but readable
					console.log(`  \x1b[90m${item.label}\x1b[0m`);
				} else if (index === selectedIndex) {
					console.log(`\x1b[32m❯ ${item.label}\x1b[0m`);
				} else {
					console.log(`  ${item.label}`);
				}
			});
			console.log('\n(Use ↑/↓ arrows to navigate, Enter to select)');
		};

		const moveCursor = (direction: 1 | -1) => {
			let next = selectedIndex;
			const len = items.length;
			for (let i = 1; i <= len; i++) {
				const candidate = (selectedIndex + direction * i + len) % len;
				if (!items[candidate].disabled) { next = candidate; break; }
			}
			selectedIndex = next;
		};

		const onKeyPress = (str: string, key: any) => {
			if (!key) return;
			if (allowSaveAction && key.ctrl && key.name === 's') {
				cleanup();
				reject(new Error('SAVE_AND_RETURN'));
			} else if (key.name === 'up') {
				moveCursor(-1);
				renderMenu();
			} else if (key.name === 'down') {
				moveCursor(1);
				renderMenu();
			} else if (key.name === 'return' || key.name === 'enter') {
				if (items[selectedIndex].disabled) return; // safety guard
				const selectedValue = items[selectedIndex].value;
				cleanup();
				// Flush any buffered input to prevent Enter leaking into the next prompt
				setImmediate(() => resolve(selectedValue));
			} else if (key.ctrl && key.name === 'c') {
				cleanup();
				process.exit(0);
			}
		};

		const cleanup = () => {
			if (process.stdin.isTTY) process.stdin.setRawMode(false);
			process.stdin.removeListener('keypress', onKeyPress);
			process.stdin.pause();
			if (rl) rl.close();
		};

		if (process.stdin.isTTY) {
			process.stdin.setRawMode(true);
			process.stdin.resume();
			readline.emitKeypressEvents(process.stdin);
			process.stdin.on('keypress', onKeyPress);
		} else {
			// Fallback if not TTY
			rl = readline.createInterface({ input: process.stdin, output: process.stdout });
			console.log(question);
			if (allowSaveAction) console.log(`(Type '!save' to save immediately and return)`);
			items.forEach((item, i) => console.log(`${i + 1}. ${item.label}${item.disabled ? ' (unavailable)' : ''}`));
			rl.question('Select option number: ', (answer) => {
				if (allowSaveAction && answer.trim().toLowerCase() === '!save') {
					cleanup();
					reject(new Error('SAVE_AND_RETURN'));
					return;
				}
				const idx = parseInt(answer, 10) - 1;
				cleanup();
				resolve(items[idx] && !items[idx].disabled ? items[idx].value : items[firstEnabled >= 0 ? firstEnabled : 0].value);
			});
			return;
		}

		renderMenu();
	});
};

const pausePrompt = async (ms: number = 1500) => {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
};

// Check if the current process has Windows Administrator privileges
const isAdmin = (): boolean => {
	if (!isWindows) return false;
	try {
		execSync('net session', { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
};
const _isAdmin = isWindows ? isAdmin() : false;
const _isRoot = !isWindows ? (process.getuid ? process.getuid() === 0 : false) : false;

// ... parsing logic
const parseEnv = async (): Promise<CloudflareConfig | null> => {
	try {
		const envPath = getEnvPath();
		if (!(await fileExists(envPath))) return null;
		const text = await fsPromises.readFile(envPath, 'utf8');
		const lines = text.split('\n');
		const env: Record<string, string> = {};
		let hasCddsKey = false;
		for (const line of lines) {
			const [key, ...rest] = line.split('=');
			if (key && rest.length > 0) {
				const trimmedKey = key.trim().replace(/^export\s+/, '');
				if (trimmedKey.startsWith('CDDS_')) hasCddsKey = true;
				env[trimmedKey] = rest.join('=').trim();
			}
		}
		
		if (!hasCddsKey) return null; // Ignore .env files that don't belong to CDDS

		const apiKey = env.CDDS_API_KEY || '';
		return {
			apiKey,
			apiKeyType: apiKey ? detectApiKeyType(apiKey) : 'token',
			email: env.CDDS_EMAIL || '',
			targets: env.CDDS_TARGETS ? env.CDDS_TARGETS.split(',').map(t => t.trim()) : [],
			zoneId: env.CDDS_ZONE_ID || '',
			ttl: parseInt(env.CDDS_TTL || '60', 10),
			checkIntervalMinutes: parseInt(env.CDDS_CHECK_INTERVAL || '5', 10),
			logs: true,
			logLevel: (env.CDDS_LOG_LEVEL as any) ?? (env.CDDS_LOGS === 'false' ? 'error' : 'info'),
			logConsole: env.CDDS_LOG_CONSOLE !== 'false',
			logFile: env.CDDS_LOG_FILE === 'true' || env.CDDS_ACTION_LOGFILE === 'true' || env.CDDS_IP_LOGFILE === 'true',
			logEndpoint: env.CDDS_LOG_ENDPOINT && env.CDDS_LOG_ENDPOINT.toLowerCase() !== 'false' ? env.CDDS_LOG_ENDPOINT : false,
			discordMessageFormat: env.CDDS_DISCORD_MESSAGE_FORMAT || '**[{level}]** {message}',
			logFormat: (env.CDDS_LOG_FORMAT as any) ?? 'text',
			logMaxLines: parseInt(env.CDDS_LOG_MAX_LINES ?? '1000', 10),
			dryRun: false,
			ipType: ['ipv4', 'ipv6', 'both'].includes(env.CDDS_IP_TYPE?.toLowerCase() || '') ? env.CDDS_IP_TYPE!.toLowerCase() as any : 'ipv4',
			proxied: env.CDDS_PROXIED === 'true'
		};
	} catch (e) {
		return null;
	}
};

// --- WIZARD ---
const runEnvWizard = async (initialConfig: CloudflareConfig | null) => {
	const envPath = getEnvPath();
	let existingLines: string[] = [];
	const existingVars: Record<string, string> = {};
	try {
		const text = await fsPromises.readFile(envPath, 'utf8');
		const lines = text.split(/\r?\n/);
		for (const line of lines) {
			if (!line.trim().startsWith('CDDS_')) {
				existingLines.push(line);
			} else {
				const match = line.match(/^(?:export\s+)?(CDDS_[A-Z_]+)=(.*)$/);
				if (match) existingVars[match[1]] = match[2];
			}
		}
		while (existingLines.length > 0 && existingLines[existingLines.length - 1].trim() === '') {
			existingLines.pop();
		}
	} catch { }

	let apiKey = existingVars['CDDS_API_KEY'] || initialConfig?.apiKey || '';
	let email = existingVars['CDDS_EMAIL'] || initialConfig?.email || '';
	let targets = existingVars['CDDS_TARGETS'] || initialConfig?.targets.join(', ') || '';
	let zoneId = existingVars['CDDS_ZONE_ID'] || initialConfig?.zoneId || '';
	let ttl = existingVars['CDDS_TTL'] || initialConfig?.ttl?.toString() || '60';
	let interval = existingVars['CDDS_CHECK_INTERVAL'] || initialConfig?.checkIntervalMinutes?.toString() || '5';
	let ipType = existingVars['CDDS_IP_TYPE'] || initialConfig?.ipType || 'ipv4';
	let logs = existingVars['CDDS_LOG_LEVEL'] || (initialConfig?.logLevel !== 'error' ? 'info' : 'error');
	let proxied = existingVars['CDDS_PROXIED'] || (initialConfig?.proxied ? 'true' : 'false');
	let logFile = existingVars['CDDS_LOG_FILE'] || 'false';
	let logEndpoint = existingVars['CDDS_LOG_ENDPOINT'] || (initialConfig?.logEndpoint || 'false');
	let discordMessageFormat = existingVars['CDDS_DISCORD_MESSAGE_FORMAT'] || initialConfig?.discordMessageFormat || '**[{level}]** {message}';
	
	let systemdMode = existingVars['CDDS_SYSTEMD_MODE'] || process.env.CDDS_SYSTEMD_MODE || 'false';
	let logFormat = existingVars['CDDS_LOG_FORMAT'] || initialConfig?.logFormat || 'text';
	let logMaxLines = existingVars['CDDS_LOG_MAX_LINES'] || initialConfig?.logMaxLines?.toString() || '1000';
	let debugMode = existingVars['CDDS_DEBUG'] || process.env.CDDS_DEBUG || 'false';

	try {
		apiKey = await textPrompt('Cloudflare API Key / Token:', apiKey, true);
		const keyType = detectApiKeyType(apiKey);
		if (keyType === 'key') {
			email = await textPrompt('Cloudflare Email (required for Global API Key):', email, true);
		} else {
			email = ''; // Clear email if it's a token
		}
		targets = await textPrompt('Targets (comma separated, e.g. sub.domain.com):', targets, true);
		zoneId = await textPrompt('Zone ID (Optional, leave empty for auto-discover):', zoneId, true);
		ttl = await textPrompt('TTL in seconds:', ttl, true);
		interval = await textPrompt('Check interval in minutes:', interval, true);
		ipType = await selectPrompt('IP Type to update:', [
			{ label: 'IPv4 (A)', value: 'ipv4' },
			{ label: 'IPv6 (AAAA)', value: 'ipv6' },
			{ label: 'Both (A + AAAA)', value: 'both' }
		], ipType === 'both' ? 2 : (ipType === 'ipv6' ? 1 : 0), true) as any;

		proxied = await selectPrompt('Enable Cloudflare Proxy (Orange Cloud)?', [
			{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
		], proxied === 'false' ? 1 : 0, true);

		const masterLogs = await selectPrompt('Do you want to enable logging?', [
			{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
		], logs === 'error' && logFile === 'false' ? 1 : 0, true);

		if (masterLogs === 'true') {
			logs = await selectPrompt('Log level:', [
				{ label: 'Info (recommended)', value: 'info' },
				{ label: 'Debug (verbose)', value: 'debug' },
				{ label: 'Warn (warnings and errors only)', value: 'warn' },
				{ label: 'Error (errors only)', value: 'error' }
			], ['info', 'debug', 'warn', 'error'].indexOf(logs) >= 0 ? ['info', 'debug', 'warn', 'error'].indexOf(logs) : 0, true) as string;
			logConsole = await selectPrompt('Output logs to console?', [
				{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
			], logConsole === 'true' ? 0 : 1, true);
			logFile = await selectPrompt('Save logs to a file (cdds.log)?', [
				{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
			], logFile === 'true' ? 0 : 1, true);
			logEndpoint = await textPrompt('Send logs to HTTP Endpoint URL (leave empty to disable):', logEndpoint === 'false' ? '' : logEndpoint, true);
			if (!logEndpoint) {
				logEndpoint = 'false';
			} else if (logEndpoint.includes('discord.com/api/webhooks')) {
				discordMessageFormat = await textPrompt('Discord Webhook detected! Message format (variables: {level}, {tag}, {timestamp}, {message}):', discordMessageFormat, true);
			}
		} else {
			logs = 'error';
			logConsole = 'false';
			logFile = 'false';
			logEndpoint = 'false';
		}

		if (process.env.CDDS_DEBUG === 'true') {
			systemdMode = await selectPrompt('Enable Systemd Mode (disable file logging if journald is active)?', [
				{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
			], systemdMode === 'true' ? 0 : 1, true);
			
			logFormat = await selectPrompt('Log format:', [
				{ label: 'Text', value: 'text' }, { label: 'JSON', value: 'json' }
			], logFormat === 'json' ? 1 : 0, true);
			
			logMaxLines = await textPrompt('Max log lines (before rotation):', logMaxLines, true);
			
			debugMode = await selectPrompt('Enable CDDS_DEBUG permanently?', [
				{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
			], debugMode === 'true' ? 0 : 1, true);
		}
	} catch (e: any) {
		if (e.message !== 'SAVE_AND_RETURN') {
			throw e;
		}
	}

	existingVars['CDDS_API_KEY'] = apiKey;
	if (email) existingVars['CDDS_EMAIL'] = email;
	else delete existingVars['CDDS_EMAIL'];
	existingVars['CDDS_TARGETS'] = targets;
	if (zoneId) existingVars['CDDS_ZONE_ID'] = zoneId;
	else delete existingVars['CDDS_ZONE_ID'];
	existingVars['CDDS_TTL'] = ttl;
	existingVars['CDDS_CHECK_INTERVAL'] = interval;
	existingVars['CDDS_IP_TYPE'] = ipType;
	existingVars['CDDS_PROXIED'] = proxied;
	existingVars['CDDS_LOG_LEVEL'] = logs;
	existingVars['CDDS_LOG_CONSOLE'] = logConsole;
	existingVars['CDDS_LOG_FILE'] = logFile;
	if (logEndpoint !== 'false') {
		existingVars['CDDS_LOG_ENDPOINT'] = logEndpoint;
		if (logEndpoint.includes('discord.com/api/webhooks')) {
			existingVars['CDDS_DISCORD_MESSAGE_FORMAT'] = discordMessageFormat;
		} else {
			delete existingVars['CDDS_DISCORD_MESSAGE_FORMAT'];
		}
	} else {
		delete existingVars['CDDS_LOG_ENDPOINT'];
		delete existingVars['CDDS_DISCORD_MESSAGE_FORMAT'];
	}
	
	if (process.env.CDDS_DEBUG === 'true') {
		existingVars['CDDS_SYSTEMD_MODE'] = systemdMode;
		existingVars['CDDS_LOG_FORMAT'] = logFormat;
		existingVars['CDDS_LOG_MAX_LINES'] = logMaxLines;
		existingVars['CDDS_DEBUG'] = debugMode;
	}

	let envContent = existingLines.length > 0 ? existingLines.join('\n') + '\n\n' : '';
	for (const [key, value] of Object.entries(existingVars)) {
		envContent += `${key}=${value}\n`;
	}

	try {
		await fsPromises.mkdir(dirname(envPath), { recursive: true });
		await fsPromises.writeFile(envPath, envContent, "utf8");
		logMessage("Generated .env file via Wizard.");
		
		const action = await selectPrompt('Saved .env successfully! What do you want to do now?', [
			{ label: 'Install as a service', value: 'install' },
			{ label: 'Run temporarily (built-in daemon)', value: 'daemon' },
			{ label: 'Return to main menu', value: 'menu' }
		]);
		
		if (action === 'install') return 'install_prompt';
		if (action === 'daemon') return 'daemon';
		return 'menu';
	} catch (e: any) {
		console.log(`\x1b[31m\nFailed to save configuration file: ${e.message}\x1b[0m`);
		console.log(`Please check if you have write permissions to: ${envPath}`);
		await selectPrompt('Press Enter to return to main menu', [{ label: 'Return', value: 'menu' }]);
		return 'menu';
	}
};

// --- SERVICE MANAGERS ---
let _pm2Cmd: string | null = null;
const isPM2Available = (): boolean => {
	if (_pm2Cmd) return true;
	try { execSync(isWindows ? 'where pm2' : 'which pm2', { stdio: 'ignore' }); _pm2Cmd = 'pm2'; return true; } catch {}
	try { execSync('npx pm2 --version', { stdio: 'ignore' }); _pm2Cmd = 'npx pm2'; return true; } catch {}
	try { execSync('bunx pm2 --version', { stdio: 'ignore' }); _pm2Cmd = 'bunx pm2'; return true; } catch {}
	return false;
};

const isSystemdAvailable = (): boolean => {
	if (isWindows) return false;
	try { execSync('systemctl --version', { stdio: 'ignore' }); return true; } catch { return false; }
};

const isWindowsAdmin = (): boolean => {
	if (!isWindows) return false;
	try { execSync('net session', { stdio: 'ignore' }); return true; } catch { return false; }
};

const checkConfigValid = async (): Promise<boolean> => {
	try {
		const cfg = await parseEnv();
		if (!cfg) return false;
		validateConfig(cfg);
		return true;
	} catch {
		return false;
	}
};

const TASK_NAME = 'Cloudflare-Dynamic-DNS-Service';

const runSystemdManager = async () => {
	const SERVICE_NAME = 'cloudflare-dynamic-dns-service';

	const getSystemdStatus = (): string => {
		try {
			const out = execSync(`systemctl show -p LoadState -p ActiveState -p MainPID ${SERVICE_NAME}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
			let loadState = '', activeState = '', mainPid = '';
			for (const line of out.split('\n')) {
				if (line.startsWith('LoadState=')) loadState = line.split('=')[1];
				if (line.startsWith('ActiveState=')) activeState = line.split('=')[1];
				if (line.startsWith('MainPID=')) mainPid = line.split('=')[1];
			}
			
			if (loadState === 'not-found') return 'Not Installed';
			if (activeState === 'active') return `Running (PID: ${mainPid !== '0' ? mainPid : '?'})`;
			if (activeState === 'failed') return 'Failed';
			if (activeState === 'inactive' || activeState === 'deactivating') return 'Stopped';
			return `Unknown (${activeState})`;
		} catch {
			return 'Not Installed';
		}
	};

	while (true) {
		const isConfigValid = await checkConfigValid();
		const disableMsg = !isConfigValid ? ' (requires valid configuration)' : '';

		const statusRaw = getSystemdStatus();
		const notInstalled = statusRaw === 'Not Installed';
		const isRunning = statusRaw.startsWith('Running');
		const isFailed = statusRaw === 'Failed';
		
		let statusColor = '\x1b[33m';
		if (isRunning) statusColor = '\x1b[32m';
		if (notInstalled || isFailed) statusColor = '\x1b[31m';

		const items = [
			...(notInstalled ? [{ label: `Install & Start Service (Systemd)${disableMsg}`, value: 'install', disabled: !isConfigValid }] : []),
			...(!notInstalled && isRunning ? [{ label: `Reload (restart with latest config)${disableMsg}`, value: 'reload', disabled: !isConfigValid }] : []),
			...(!notInstalled && isRunning ? [{ label: 'Stop Service', value: 'pause' }] : []),
			...(!notInstalled && !isRunning ? [{ label: `Start Service${disableMsg}`, value: 'resume', disabled: !isConfigValid }] : []),
			...(!notInstalled ? [{ label: 'Uninstall / Remove Service', value: 'remove' }] : []),
			{ label: 'Refresh Status', value: 'refresh' },
			{ label: 'Go Back', value: 'back' },
		];

		const action = await selectPrompt(
			`--- SYSTEMD MANAGER ---\nService: ${SERVICE_NAME}.service\nStatus: ${statusColor}${statusRaw}\x1b[0m`,
			items
		);

		if (action === 'back') break;
		if (action === 'refresh') continue;

		if (!_isRoot) {
			console.log('\x1b[31mERROR: Root privileges required! Please run CLI with sudo.\x1b[0m');
			await pausePrompt();
			continue;
		}

		try {
			const cfg = await parseEnv();
			if (!cfg) throw new Error("No .env file found. Please run the configuration wizard first.");
			validateConfig(cfg);

			if (action === 'install') {
				const projectPath = getLogDir();
				const rt = detectRuntime();
				const scriptPath = import.meta.url ? new URL(import.meta.url).pathname : process.argv[1];
				const envPath = getEnvPath();
				const serviceContent = `[Unit]
Description=Cloudflare Dynamic DNS Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${projectPath}
ExecStart=${rt.fullCommand} ${scriptPath} start --env ${envPath}
Restart=on-failure
RestartSec=10
Environment="PATH=${process.env.PATH}"
Environment="CDDS_ENV_PATH=${envPath}"
Environment="CDDS_SYSTEMD_MODE=true"
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=${SERVICE_NAME}

[Install]
WantedBy=multi-user.target
`;
				await fsPromises.writeFile(`/etc/systemd/system/${SERVICE_NAME}.service`, serviceContent, "utf8");
				execSync('systemctl daemon-reload');
				execSync(`systemctl enable ${SERVICE_NAME}`);
				execSync(`systemctl start ${SERVICE_NAME}`);
				console.log('\x1b[32mSUCCESS: Systemd Service installed and started successfully!\x1b[0m');
				logMessage(`Systemd: Installed and started ${SERVICE_NAME}.service`);
			} else if (action === 'pause') {
				execSync(`systemctl stop ${SERVICE_NAME}`);
				console.log('\x1b[32mSUCCESS: Systemd Service stopped.\x1b[0m');
				logMessage(`Systemd: Stopped ${SERVICE_NAME}`);
			} else if (action === 'resume') {
				execSync(`systemctl start ${SERVICE_NAME}`);
				console.log('\x1b[32mSUCCESS: Systemd Service started.\x1b[0m');
				logMessage(`Systemd: Started ${SERVICE_NAME}`);
			} else if (action === 'reload') {
				execSync(`systemctl restart ${SERVICE_NAME}`);
				console.log('\x1b[32mSUCCESS: Systemd Service reloaded successfully with latest .env.\x1b[0m');
				logMessage(`Systemd: Reloaded ${SERVICE_NAME}`);
			} else if (action === 'remove') {
				try { execSync(`systemctl stop ${SERVICE_NAME}`); } catch {}
				try { execSync(`systemctl disable ${SERVICE_NAME}`); } catch {}
				try { execSync(`rm /etc/systemd/system/${SERVICE_NAME}.service`); } catch {}
				try { execSync('systemctl daemon-reload'); } catch {}
				console.log('\x1b[32mSUCCESS: Systemd Service completely removed.\x1b[0m');
				logMessage(`Systemd: Removed ${SERVICE_NAME}`);
			}
		} catch (e: any) {
			console.log(`\x1b[31mERROR: ${e.message}\x1b[0m`);
		}
		await pausePrompt();
	}
};

const runPM2Manager = async () => {
	const PM2_SERVICE_NAME = 'Cloudflare-Dynamic-DNS-Service';

	// Query PM2 for our specific CDDS process
	interface PM2Process { name: string; pm_id: number; pm2_env: { status: string } }
	const getPM2Status = (): PM2Process | null => {
		try {
			const raw = execSync(`${_pm2Cmd || 'pm2'} jlist`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
			const list: PM2Process[] = JSON.parse(raw);
			return list.find(p => p.name === PM2_SERVICE_NAME) || null;
		} catch (e: any) {
			if (e.message?.includes('EPERM') || e.stderr?.includes('EPERM')) {
				throw new Error(`EPERM: Cannot connect to PM2 daemon.\n\nThe PM2 daemon was started by a different process or user.\nRun \x1b[33m${_pm2Cmd || 'pm2'} kill\x1b[0m in your terminal and try again.`);
			}
			return null;
		}
	};

	while (true) {
		const isConfigValid = await checkConfigValid();
		const disableMsg = !isConfigValid ? ' (requires valid configuration)' : '';

		let primary: PM2Process | null = null;
		let pm2Error = '';

		try {
			primary = getPM2Status();
		} catch (e: any) {
			pm2Error = `\x1b[31m${e.message}\x1b[0m\n`;
		}

		const isOnline = primary?.pm2_env.status === 'online';
		const isStopped = primary && !isOnline;
		const notInstalled = !primary;

		// Status label
		let statusLabel: string;
		if (pm2Error) {
			statusLabel = '\x1b[31mError (cannot connect to PM2 daemon)\x1b[0m';
		} else if (notInstalled) {
			statusLabel = '\x1b[31mNot Installed\x1b[0m';
		} else {
			const statusColor = isOnline ? '\x1b[32m' : '\x1b[33m';
			statusLabel = `${statusColor}${primary!.pm2_env.status}\x1b[0m  [ID: ${primary!.pm_id}, Name: ${primary!.name}]`;
		}

		const items: { label: string; value: string; disabled?: boolean }[] = [
			...(notInstalled && !pm2Error ? [{ label: `Install & Start Service (PM2)${disableMsg}`, value: 'install', disabled: !isConfigValid }] : []),
			...(!notInstalled && isOnline ? [{ label: `Reload (restart with latest config)${disableMsg}`, value: 'reload', disabled: !isConfigValid }] : []),
			...(!notInstalled && isOnline ? [{ label: 'Stop Service', value: 'pause' }] : []),
			...(!notInstalled && isStopped ? [{ label: `Start Service${disableMsg}`, value: 'resume', disabled: !isConfigValid }] : []),
			...(!notInstalled ? [{ label: 'Uninstall / Remove Service', value: 'remove' }] : []),
			...(!pm2Error ? [{ label: `Save Services (${_pm2Cmd || 'pm2'} save)`, value: 'save' }] : []),
			{ label: 'Refresh Status', value: 'refresh' },
			{ label: 'Go Back', value: 'back' },
		];

		const action = await selectPrompt(
			`--- PM2 SERVICE MANAGER ---\nService: ${PM2_SERVICE_NAME}\n${pm2Error}Status: ${statusLabel}`,
			items
		);

		if (action === 'back') break;
		if (action === 'refresh') continue;

		try {
			const cfg = await parseEnv();
			if (!cfg) throw new Error("No .env file found. Please run the configuration wizard first.");
			validateConfig(cfg);

			const targetName = primary?.name ?? PM2_SERVICE_NAME;

			if (action === 'install') {
				const rt = detectRuntime();
				const scriptPath = import.meta.url ? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') : process.argv[1];

				const pm2Content = `module.exports = {\n  apps: [\n    {\n      name: "${PM2_SERVICE_NAME}",\n      script: "${scriptPath.replace(/\\/g, '/')}",\n      args: "start --env ${getEnvPath().replace(/\\/g, '/')}",\n      interpreter: "${rt.execPath.replace(/\\/g, '/')}",\n      interpreter_args: "${rt.serviceArgs.replace(/\\/g, '/')}",\n      instances: 1,\n      autorestart: true,\n      watch: false,\n      cwd: "${getLogDir().replace(/\\/g, '/')}",\n      max_memory_restart: "100M",\n      env: { NODE_ENV: "production", CDDS_ENV_PATH: "${getEnvPath().replace(/\\/g, '/')}" },\n    },\n  ],\n};\n`;
				const pm2ConfigPath = resolve(getLogDir(), 'pm2.config.cjs');
				await fsPromises.writeFile(pm2ConfigPath, pm2Content, "utf8");
				execSync(`${_pm2Cmd || 'pm2'} start "${pm2ConfigPath}"`);
				execSync(`${_pm2Cmd || 'pm2'} save`);
				console.log('\x1b[32mSUCCESS: PM2 Service installed and started successfully!\x1b[0m');
				logMessage(`PM2: Installed and started ${PM2_SERVICE_NAME}`);
			} else if (action === 'reload') {
				const rt = detectRuntime();
				const scriptPath = import.meta.url ? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') : process.argv[1];
				const pm2Content = `module.exports = {\n  apps: [\n    {\n      name: "${targetName}",\n      script: "${scriptPath.replace(/\\/g, '/')}",\n      args: "start --env ${getEnvPath().replace(/\\/g, '/')}",\n      interpreter: "${rt.execPath.replace(/\\/g, '/')}",\n      interpreter_args: "${rt.serviceArgs.replace(/\\/g, '/')}",\n      instances: 1,\n      autorestart: true,\n      watch: false,\n      cwd: "${getLogDir().replace(/\\/g, '/')}",\n      max_memory_restart: "100M",\n      env: { NODE_ENV: "production", CDDS_ENV_PATH: "${getEnvPath().replace(/\\/g, '/')}" },\n    },\n  ],\n};\n`;
				const pm2ConfigPath = resolve(getLogDir(), 'pm2.config.cjs');
				await fsPromises.writeFile(pm2ConfigPath, pm2Content, "utf8");
				execSync(`${_pm2Cmd || 'pm2'} start "${pm2ConfigPath}"`);
				execSync(`${_pm2Cmd || 'pm2'} save`);
				console.log('\x1b[32mSUCCESS: PM2 Service restarted and updated with latest config.\x1b[0m');
				logMessage(`PM2: Reloaded ${targetName}`);
			} else if (action === 'pause') {
				execSync(`${_pm2Cmd || 'pm2'} stop "${targetName}"`);
				console.log('\x1b[32mSUCCESS: PM2 Service stopped.\x1b[0m');
				logMessage(`PM2: Stopped ${targetName}`);
			} else if (action === 'resume') {
				execSync(`${_pm2Cmd || 'pm2'} start "${targetName}"`);
				console.log('\x1b[32mSUCCESS: PM2 Service started.\x1b[0m');
				logMessage(`PM2: Started ${targetName}`);
			} else if (action === 'save') {
				execSync(`${_pm2Cmd || 'pm2'} save`);
				console.log('\x1b[32mSUCCESS: PM2 Services saved (will restore on boot if pm2 startup is configured).\x1b[0m');
				logMessage(`PM2: Saved process list`);
			} else if (action === 'remove') {
				execSync(`${_pm2Cmd || 'pm2'} delete "${targetName}"`);
				execSync(`${_pm2Cmd || 'pm2'} save`);
				console.log('\x1b[32mSUCCESS: PM2 Service removed.\x1b[0m');
				logMessage(`PM2: Removed ${targetName}`);
			}
		} catch (e: any) {
			const hint = (e.message?.includes('EPERM') || e.stderr?.includes?.('EPERM'))
				? '\n\x1b[33mHint: Run \x1b[1mpm2 kill\x1b[0m\x1b[33m in your terminal to reset the PM2 daemon, then retry.\x1b[0m'
				: '';
			console.log(`\x1b[31mERROR: ${e.message}\x1b[0m${hint}`);
		}
		await pausePrompt();
	}
};

const runTaskSchedulerManager = async () => {
	while (true) {
		const isConfigValid = await checkConfigValid();
		const disableMsg = !isConfigValid ? ' (requires valid .env)' : '';

		let taskStatus = 'Unknown';
		try {
			const out = execSync(`schtasks /query /tn "${TASK_NAME}" /fo LIST`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
			const statusMatch = out.match(/Status:\s+(.+)/i);
			taskStatus = statusMatch ? statusMatch[1].trim() : 'Unknown';
		} catch {
			taskStatus = 'Not Installed';
		}
		
		const notInstalled = taskStatus === 'Not Installed';
		const items = [
			...(notInstalled ? [{ label: `Install & Start Service (Task Scheduler)${disableMsg}`, value: 'install', disabled: !isConfigValid }] : []),
			...(!notInstalled ? [{ label: `Reload (restart with latest config)${disableMsg}`, value: 'reload', disabled: !isConfigValid }] : []),
			...(!notInstalled && taskStatus !== 'Disabled' ? [{ label: 'Stop Service', value: 'pause' }] : []),
			...(!notInstalled && taskStatus !== 'Running' && taskStatus !== 'Ready' ? [{ label: `Start Service${disableMsg}`, value: 'resume', disabled: !isConfigValid }] : []),
			...(!notInstalled ? [{ label: 'Uninstall / Remove Service', value: 'remove' }] : []),
			{ label: 'Refresh Status', value: 'refresh' },
			{ label: 'Go Back', value: 'back' },
		];

		const statusColor = taskStatus === 'Not Installed' ? '\x1b[31m' : (taskStatus === 'Disabled' ? '\x1b[33m' : '\x1b[32m');
		const action = await selectPrompt(`--- WINDOWS TASK SCHEDULER ---\nService: ${TASK_NAME}\nStatus: ${statusColor}${taskStatus}\x1b[0m`, items);

		if (action === 'back') break;
		if (action === 'refresh') continue;

		if (!isWindowsAdmin()) {
			console.log('\x1b[31mERROR: Administrator privileges required! Please run CLI as Administrator.\x1b[0m');
			await pausePrompt();
			continue;
		}

		try {
			const cfg = await parseEnv();
			if (!cfg) throw new Error('No .env file found. Please run the configuration wizard first.');
			validateConfig(cfg);

			if (action === 'install') {
					const rt = detectRuntime();
					const execPath = rt.execPath.replace(/\//g, '\\');
					const scriptPath = (import.meta.url
						? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
						: process.argv[1]
					).replace(/\//g, '\\');
					const workDir = getLogDir().replace(/\//g, '\\');
					const envPath = getEnvPath().replace(/\//g, '\\');

					// Ask about startup trigger
					const triggerType = await selectPrompt('When should the service start?', [
						{ label: 'On system boot', value: 'boot' },
						{ label: 'On system boot with custom delay', value: 'boot-delay' },
						{ label: 'On user logon', value: 'logon' },
					]);

					let triggerXml: string;
					if (triggerType === 'boot') {
						triggerXml = `<BootTrigger>\n      <Enabled>true</Enabled>\n      <Delay>PT30S</Delay>\n    </BootTrigger>`;
					} else if (triggerType === 'boot-delay') {
						const delayRaw = await textPrompt('Delay after boot (in seconds):', '60');
						const delaySec = Math.max(1, parseInt(delayRaw) || 60);
						const mins = Math.floor(delaySec / 60);
						const secs = delaySec % 60;
						const iso = `PT${mins > 0 ? `${mins}M` : ''}${secs > 0 ? `${secs}S` : ''}`;
						triggerXml = `<BootTrigger>\n      <Enabled>true</Enabled>\n      <Delay>${iso}</Delay>\n    </BootTrigger>`;
					} else {
						triggerXml = `<LogonTrigger>\n      <Enabled>true</Enabled>\n    </LogonTrigger>`;
					}

					const argsPrefix = rt.serviceArgs ? rt.serviceArgs + ' ' : '';

					// Build task XML — avoids all quoting/escaping issues with spaces in paths
					const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Cloudflare Dynamic DNS Service - keeps DNS records in sync with your public IP</Description>
  </RegistrationInfo>
  <Triggers>
    ${triggerXml}
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${execPath}</Command>
      <Arguments>${argsPrefix}"${scriptPath}" start --env "${envPath}"</Arguments>
      <WorkingDirectory>${workDir}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>`;

					// Write XML as UTF-16 LE with BOM (required by schtasks /xml)
					const tmpXml = (process.env.TEMP || process.env.TMP || 'C:\\Temp') + '\\cdds-task.xml';
					const bom = Buffer.from([0xFF, 0xFE]);
					const xmlUtf16 = Buffer.from(taskXml, 'utf16le');
					writeFileSync(tmpXml, Buffer.concat([bom, xmlUtf16]));

					execSync(`schtasks /create /tn "${TASK_NAME}" /xml "${tmpXml}" /f`);
					try { unlinkSync(tmpXml); } catch {}
					execSync(`schtasks /run /tn "${TASK_NAME}"`);
					console.log('\x1b[32mSUCCESS: Task installed and started successfully!\x1b[0m');
					logMessage(`TaskScheduler: Installed ${TASK_NAME} task`);
			} else if (action === 'pause') {
				try { execSync(`schtasks /end /tn "${TASK_NAME}"`); } catch { }
				execSync(`schtasks /change /tn "${TASK_NAME}" /disable`);
				console.log('\x1b[32mSUCCESS: Task stopped and disabled.\x1b[0m');
				logMessage('TaskScheduler: Stopped CDDS-DynamicDNS task');
			} else if (action === 'resume') {
				execSync(`schtasks /change /tn "${TASK_NAME}" /enable`);
				execSync(`schtasks /run /tn "${TASK_NAME}"`);
				console.log('\x1b[32mSUCCESS: Task re-enabled and running.\x1b[0m');
				logMessage('TaskScheduler: Resumed CDDS-DynamicDNS task');
			} else if (action === 'reload') {
				execSync(`schtasks /change /tn "${TASK_NAME}" /enable`);
				try { execSync(`schtasks /end /tn "${TASK_NAME}"`); } catch { }
				execSync(`schtasks /run /tn "${TASK_NAME}"`);
				console.log('\x1b[32mSUCCESS: Task reloaded successfully with latest config.\x1b[0m');
				logMessage('TaskScheduler: Reloaded CDDS-DynamicDNS task');
			} else if (action === 'remove') {
				try { execSync(`schtasks /end /tn "${TASK_NAME}"`); } catch { }
				execSync(`schtasks /delete /tn "${TASK_NAME}" /f`);
				console.log('\x1b[32mSUCCESS: Task completely removed.\x1b[0m');
				logMessage('TaskScheduler: Removed CDDS-DynamicDNS task');
			}
		} catch (e: any) {
			console.log(`\x1b[31mERROR: ${e.message}\x1b[0m`);
		}
		await pausePrompt();
	}
};

const runLaunchdManager = async () => {
	const isMacOS = process.platform === 'darwin';
	if (!isMacOS) return;

	const LAUNCHD_LABEL = 'com.cdds.cloudflare-dynamic-dns-service';
	// System LaunchDaemon — requires root; runs in background without GUI session
	const systemLaunchDaemonsDir = '/Library/LaunchDaemons';
	const plistPath = `${systemLaunchDaemonsDir}/${LAUNCHD_LABEL}.plist`;

	const getLaunchdStatus = (): string => {
		try {
			const out = execSync(`launchctl list ${LAUNCHD_LABEL} 2>/dev/null`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
			const pidMatch = out.match(/"PID"\s*=\s*(\d+)/);
			if (pidMatch) return `Running (PID: ${pidMatch[1]})`;
			const statusMatch = out.match(/"LastExitStatus"\s*=\s*(\d+)/);
			if (statusMatch && statusMatch[1] === '0') return 'Stopped (clean exit)';
			if (statusMatch) return `Stopped (exit code: ${statusMatch[1]})`;
			return 'Loaded (not running)';
		} catch {
			if (existsSync(plistPath)) return 'Stopped (unloaded)';
			return 'Not Installed';
		}
	};

	while (true) {
		const isConfigValid = await checkConfigValid();
		const disableMsg = !isConfigValid ? ' (requires valid configuration)' : '';

		const statusRaw = getLaunchdStatus();
		const notInstalled = statusRaw === 'Not Installed';
		const isRunning = statusRaw.startsWith('Running');
		const statusColor = isRunning ? '\x1b[32m' : (notInstalled ? '\x1b[31m' : '\x1b[33m');

		const items = [
			...(notInstalled ? [{ label: `Install & Start Service (LaunchDaemon)${disableMsg}`, value: 'install', disabled: !isConfigValid }] : []),
			...(!notInstalled && isRunning ? [{ label: `Reload (restart with latest config)${disableMsg}`, value: 'reload', disabled: !isConfigValid }] : []),
			...(!notInstalled && isRunning ? [{ label: 'Stop Service', value: 'stop' }] : []),
			...(!notInstalled && !isRunning ? [{ label: `Start Service${disableMsg}`, value: 'start', disabled: !isConfigValid }] : []),
			...(!notInstalled ? [{ label: 'Uninstall / Remove Service', value: 'remove' }] : []),
			{ label: 'Refresh Status', value: 'refresh' },
			{ label: 'Go Back', value: 'back' },
		];

		const action = await selectPrompt(
			`--- LAUNCHD MANAGER (macOS LaunchDaemon) ---\nService: ${LAUNCHD_LABEL}\nStatus: ${statusColor}${statusRaw}\x1b[0m`,
			items
		);

		if (action === 'back') break;
		if (action === 'refresh') continue;

		if (!_isRoot) {
			console.log('\x1b[31mERROR: Root privileges required! Please run CLI with sudo.\x1b[0m');
			await pausePrompt();
			continue;
		}

		try {
			const cfg = await parseEnv();
			if (!cfg) throw new Error('No .env file found. Please run the configuration wizard first.');
			validateConfig(cfg);

			const rt = detectRuntime();
			const scriptPath = import.meta.url
				? new URL(import.meta.url).pathname
				: process.argv[1];
			const workDir = getLogDir();
			const envPath = getEnvPath();

			if (action === 'install') {
				// Ensure LaunchDaemons dir exists
				await fsPromises.mkdir(systemLaunchDaemonsDir, { recursive: true });

				const commandParts = rt.fullCommand.split(' ').map(part => `<string>${part}</string>`).join('\n    ');

				const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    ${commandParts}
    <string>${scriptPath}</string>
    <string>start</string>
    <string>--env</string>
    <string>${envPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${workDir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CDDS_ENV_PATH</key>
    <string>${envPath}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${workDir}/cdds-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${workDir}/cdds-stderr.log</string>
</dict>
</plist>`;
				await fsPromises.writeFile(plistPath, plistContent, 'utf8');
				const out = execSync(`launchctl load -w "${plistPath}" 2>&1`, { encoding: 'utf8' });
				if (out.toLowerCase().includes('failed') || out.toLowerCase().includes('error')) throw new Error(out.trim());
				console.log(`\x1b[32mSUCCESS: LaunchDaemon installed and started!\x1b[0m`);
				console.log(`\x1b[90mPlist: ${plistPath}\x1b[0m`);
				logMessage(`Launchd: Installed and started ${LAUNCHD_LABEL}`);
			} else if (action === 'reload') {
				// Regenerate plist and reload
				await fsPromises.mkdir(systemLaunchDaemonsDir, { recursive: true });

				const commandParts = rt.fullCommand.split(' ').map(part => `<string>${part}</string>`).join('\n    ');

				const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    ${commandParts}
    <string>${scriptPath}</string>
    <string>start</string>
    <string>--env</string>
    <string>${envPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${workDir}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CDDS_ENV_PATH</key>
    <string>${envPath}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${workDir}/cdds-stdout.log</string>
  <key>StandardErrorPath</key>
  <string>${workDir}/cdds-stderr.log</string>
</dict>
</plist>`;
				await fsPromises.writeFile(plistPath, plistContent, 'utf8');
				try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`); } catch {}
				const out = execSync(`launchctl load -w "${plistPath}" 2>&1`, { encoding: 'utf8' });
				if (out.toLowerCase().includes('failed') || out.toLowerCase().includes('error')) throw new Error(out.trim());
				console.log('\x1b[32mSUCCESS: LaunchDaemon reloaded with latest config.\x1b[0m');
				logMessage(`Launchd: Reloaded ${LAUNCHD_LABEL}`);
			} else if (action === 'stop') {
				const out = execSync(`launchctl unload "${plistPath}" 2>&1`, { encoding: 'utf8' });
				if (out.toLowerCase().includes('failed') || out.toLowerCase().includes('error')) throw new Error(out.trim());
				console.log('\x1b[32mSUCCESS: LaunchDaemon stopped.\x1b[0m');
				logMessage(`Launchd: Stopped ${LAUNCHD_LABEL}`);
			} else if (action === 'start') {
				const out = execSync(`launchctl load -w "${plistPath}" 2>&1`, { encoding: 'utf8' });
				if (out.toLowerCase().includes('failed') || out.toLowerCase().includes('error')) throw new Error(out.trim());
				console.log('\x1b[32mSUCCESS: LaunchDaemon started.\x1b[0m');
				logMessage(`Launchd: Started ${LAUNCHD_LABEL}`);
			} else if (action === 'remove') {
				try { execSync(`launchctl unload "${plistPath}" 2>/dev/null`); } catch {}
				try { await fsPromises.unlink(plistPath); } catch {}
				console.log('\x1b[32mSUCCESS: LaunchDaemon stopped and plist removed.\x1b[0m');
				logMessage(`Launchd: Removed ${LAUNCHD_LABEL}`);
			}
		} catch (e: any) {
			console.log(`\x1b[31mERROR: ${e.message}\x1b[0m`);
		}
		await pausePrompt();
	}
};

const runDaemonManager = async () => {
	while (true) {
		const isConfigValid = await checkConfigValid();
		const disableMsg = !isConfigValid ? ' (requires valid configuration)' : '';

		let running = false;
		let pid: number | null = null;
		let requiresElevated = false;
		let staleProtected = false;
		
		try {
			if (await fileExists(getPidFile())) {
				const stored = parseInt(await fsPromises.readFile(getPidFile(), 'utf8'), 10);
				if (stored && !isNaN(stored)) {
					try {
						process.kill(stored, 0);
						pid = stored;
						running = true;
					} catch (e: any) {
						if (e.code === 'EPERM') {
							pid = stored;
							running = true;
							requiresElevated = true;
						} else {
							try {
								await fsPromises.writeFile(getPidFile(), '', "utf8");
							} catch (writeErr: any) {
								if (writeErr.code === 'EACCES' || writeErr.code === 'EPERM') {
									staleProtected = true;
								}
							}
						}
					}
				}
			}
		} catch {}

		const items = [
			...(staleProtected ? [{ label: '\x1b[31m[!] Stale PID file requires sudo to clean\x1b[0m', value: 'stale_clean' }] : []),
			...(!running ? [{ label: `Start Daemon (background)${disableMsg}`, value: 'start', disabled: !isConfigValid || staleProtected }] : []),
			...(running ? [{ label: `Reload Daemon (restart with latest config)${disableMsg}`, value: 'reload', disabled: !isConfigValid || requiresElevated }] : []),
			...(running ? [{ label: 'Stop Daemon', value: 'stop', disabled: requiresElevated }] : []),
			{ label: 'Refresh Status', value: 'refresh' },
			{ label: 'Go Back', value: 'back' },
		];

		let statusText = '\x1b[31mStopped\x1b[0m';
		if (running) {
			statusText = `\x1b[32mRunning\x1b[0m (PID: ${pid})`;
			if (requiresElevated) statusText += ' — \x1b[31m[Requires Sudo]\x1b[0m';
		} else if (staleProtected) {
			statusText = `\x1b[31mStopped\x1b[0m — \x1b[31m[PID file locked by another user]\x1b[0m`;
		}

		const action = await selectPrompt(`--- DAEMON MANAGER (Built-in) ---\nStatus: ${statusText}`, items);


		if (action === 'back') break;
		if (action === 'refresh') continue;
		if (action === 'stale_clean') {
			console.log('\x1b[31mERROR: The PID file is locked by another user (likely root). Please run "sudo cdds daemon" to clean it up.\x1b[0m');
			await pausePrompt();
			continue;
		}

		try {
			if (action === 'start') {
				const cfg = await parseEnv();
				if (!cfg) throw new Error('No .env file found. Run the configuration wizard first.');
				validateConfig(cfg);

				const bunExec = process.execPath;
				const scriptPath = import.meta.url ? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') : process.argv[1];
				
				let childPid: number;
				if (isWindows) {
					// Use PowerShell to completely detach and hide the window on Windows, avoiding Windows Terminal tab switching
					const psCmd = `(Start-Process -FilePath '${bunExec}' -ArgumentList '"${scriptPath}"', 'start' -WindowStyle Hidden -PassThru).Id`;
					const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8' });
					childPid = parseInt(out.trim(), 10);
				} else {
					const child = spawn(bunExec, [scriptPath, 'start'], {
						detached: true,
						stdio: ['ignore', 'ignore', 'ignore'],
						env: { ...process.env },
					});
					child.unref();
					childPid = child.pid!;
				}
				
				await fsPromises.writeFile(getPidFile(), childPid.toString(), "utf8");
				logMessage(`Daemon: Started (PID: ${childPid})`);
				console.log(`\x1b[32mSUCCESS: Daemon started! (PID: ${childPid})\x1b[0m`);
			} else if (action === 'stop') {
				if (!running || !pid) throw new Error('Daemon is not running.');
				process.kill(pid, 'SIGTERM');
				await fsPromises.writeFile(getPidFile(), '', "utf8");
				logMessage(`Daemon: Stopped (PID: ${pid})`);
				console.log(`\x1b[32mSUCCESS: Daemon stopped (PID: ${pid}).\x1b[0m`);
			} else if (action === 'reload') {
				if (!running || !pid) throw new Error('Daemon is not running.');
				const cfg = await parseEnv();
				if (!cfg) throw new Error('No .env file found. Run the configuration wizard first.');
				validateConfig(cfg);

				// Stop the old process
				process.kill(pid, 'SIGTERM');
				await new Promise<void>((resolve) => setTimeout(resolve, 1000));

				// Start fresh with latest config
				const bunExec = process.execPath;
				const scriptPath = import.meta.url ? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') : process.argv[1];
				
				let childPid: number;
				if (isWindows) {
					const psCmd = `(Start-Process -FilePath '${bunExec}' -ArgumentList '"${scriptPath}"', 'start' -WindowStyle Hidden -PassThru).Id`;
					const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8' });
					childPid = parseInt(out.trim(), 10);
				} else {
					const child = spawn(bunExec, [scriptPath, 'start'], {
						detached: true,
						stdio: ['ignore', 'ignore', 'ignore'],
						env: { ...process.env },
					});
					child.unref();
					childPid = child.pid!;
				}
				
				await fsPromises.writeFile(getPidFile(), childPid.toString(), "utf8");
				logMessage(`Daemon: Reloaded (old PID: ${pid}, new PID: ${childPid})`);
				console.log(`\x1b[32mSUCCESS: Daemon reloaded! (old PID: ${pid} → new PID: ${childPid})\x1b[0m`);
			}
		} catch (e: any) {
			if (e.code === 'ESRCH') {
				await fsPromises.writeFile(getPidFile(), '', "utf8");
				console.log('\x1b[32mSUCCESS: Daemon was not running (stale PID removed).\x1b[0m');
			} else {
				console.log(`\x1b[31mERROR: ${e.message}\x1b[0m`);
			}
		}
		await pausePrompt();
	}
};

const checkForUpdates = async () => {
	console.clear();
	console.log('\x1b[34m\x1b[1m--- CDDS UPDATER ---\x1b[0m\n');
	console.log("Checking for updates...");
	try {
		let currentVersion = '1.0.0';
		try {
			let pkgPath = new URL('../package.json', import.meta.url);
			let fileContent = '';
			try {
				fileContent = await fsPromises.readFile(pkgPath, 'utf8');
			} catch {
				pkgPath = new URL('./package.json', import.meta.url);
				fileContent = await fsPromises.readFile(pkgPath, 'utf8');
			}
			const pkg = JSON.parse(fileContent);
			currentVersion = pkg.version;
		} catch (e) {}

		const response = await fetch('https://registry.npmjs.org/cloudflare-dynamic-dns-service/latest');
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const latestData = await response.json() as any;
		const latestVersion = latestData.version;

		if (!isNewer(latestVersion, currentVersion)) {
			console.log(`\x1b[32mYou are using the latest version (v${currentVersion}).\x1b[0m`);
			await pausePrompt();
			return;
		}

		const scriptPath = (process.argv[1] || import.meta.url).toLowerCase();
		let pmName = 'NPM';
		let installCmd = `npm install -g cloudflare-dynamic-dns-service@${latestVersion}`;

		if (typeof (process.versions as any)?.bun !== 'undefined') {
			pmName = 'Bun';
			installCmd = `bun add -g cloudflare-dynamic-dns-service@${latestVersion}`;
		} else if (typeof (globalThis as any).Deno !== 'undefined') {
			pmName = 'Deno';
			installCmd = `deno install -gf npm:cloudflare-dynamic-dns-service@${latestVersion}`;
		} else if (scriptPath.includes('.yarn') || scriptPath.includes('yarn')) {
			pmName = 'Yarn';
			installCmd = `yarn global add cloudflare-dynamic-dns-service@${latestVersion}`;
		} else if (scriptPath.includes('.pnpm') || scriptPath.includes('pnpm')) {
			pmName = 'pnpm';
			installCmd = `pnpm add -g cloudflare-dynamic-dns-service@${latestVersion}`;
		}

		// Fallback check: if NPM is selected but not installed, try to use Bun if available
		if (pmName === 'NPM') {
			try {
				execSync(isWindows ? 'where npm' : 'which npm', { stdio: 'ignore' });
			} catch {
				try {
					execSync(isWindows ? 'where bun' : 'which bun', { stdio: 'ignore' });
					pmName = 'Bun';
					installCmd = `bun add -g cloudflare-dynamic-dns-service@${latestVersion}`;
				} catch {}
			}
		}

		console.log(`\n\x1b[33mNew version available! v${currentVersion} \u2192 v${latestVersion}\x1b[0m`);
		console.log(`Detected package manager: ${pmName}\n`);
		
		const action = await selectPrompt(`Would you like to upgrade to v${latestVersion} now?`, [
			{ label: 'Yes, upgrade now', value: 'yes' },
			{ label: 'No, maybe later', value: 'no' }
		]);

		if (action === 'no') {
			console.log(`\n\x1b[33mUpgrade skipped.\x1b[0m`);
			return;
		}

		console.log(`\nRunning: ${installCmd}`);
		execSync(installCmd, { stdio: 'inherit' });
		console.log(`\n\x1b[32mSuccessfully upgraded to v${latestVersion}!\x1b[0m`);

		// --- Detect running services (split by permission access) ---
		type RunningService = { label: string; restart: () => void };
		const restartable: RunningService[] = [];  // user has permission
		const locked: string[] = [];               // running but no permission

		// Built-in Daemon — always restartable (owned by current user)
		try {
			if (await fileExists(getPidFile())) {
				const pid = parseInt(await fsPromises.readFile(getPidFile(), 'utf8'), 10);
				if (pid && !isNaN(pid)) {
					try {
						process.kill(pid, 0);
						restartable.push({
							label: 'Built-in Daemon',
							restart: () => { process.kill(pid, 'SIGTERM'); }
						});
					} catch (err: any) { debugLog(`Built-in daemon kill test failed: ${err.message}`); }
				}
			}
		} catch (err: any) { debugLog(`Built-in daemon check failed: ${err.message}`); }

		// PM2 — no elevated privileges needed
		if (isPM2Available()) {
			try {
				const PM2_SVC = 'Cloudflare-Dynamic-DNS-Service';
				const raw = execSync(`${_pm2Cmd || 'pm2'} jlist`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
				const list = JSON.parse(raw) as any[];
				const cddsProc = list.find((p: any) => p.name === PM2_SVC && p.pm2_env?.status === 'online');
				if (cddsProc) {
					restartable.push({
						label: 'PM2 Service',
						restart: () => { execSync(`${_pm2Cmd || 'pm2'} restart "${PM2_SVC}"`, { stdio: 'ignore' }); }
					});
				}
			} catch (err: any) { debugLog(`PM2 check failed: ${err.message}`); }
		}

		// Systemd
		if (isSystemdAvailable()) {
			try {
				const SYSTEMD_SVC = 'cloudflare-dynamic-dns-service';
				const out = execSync(`systemctl is-active ${SYSTEMD_SVC} 2>/dev/null`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
				if (out === 'active') {
					if (_isRoot) {
						restartable.push({
							label: 'Systemd Service',
							restart: () => { execSync(`systemctl restart ${SYSTEMD_SVC}`, { stdio: 'inherit' }); }
						});
					} else {
						locked.push('Systemd Service (requires root)');
					}
				}
			} catch (err: any) { debugLog(`Systemd check failed: ${err.message}`); }
		}

		// Windows Task Scheduler
		if (isWindows) {
			try {
				const out = execSync(`schtasks /query /tn "${TASK_NAME}" /fo LIST`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
				if (out.includes('Running') || out.includes('Ready')) {
					if (_isAdmin) {
						restartable.push({
							label: 'Windows Task Scheduler',
							restart: () => {
								try { execSync(`schtasks /end /tn "${TASK_NAME}"`, { stdio: 'ignore' }); } catch { }
								execSync(`schtasks /run /tn "${TASK_NAME}"`, { stdio: 'ignore' });
							}
						});
					} else {
						locked.push('Windows Task Scheduler (requires Administrator)');
					}
				}
			} catch (err: any) { debugLog(`Windows Task Scheduler check failed: ${err.message}`); }
		}

		// Launchd (macOS)
		if (process.platform === 'darwin') {
			const LAUNCHD_LBL = 'com.cdds.cloudflare-dynamic-dns-service';
			try {
				const out = execSync(`launchctl list ${LAUNCHD_LBL} 2>/dev/null`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
				if (out.includes('"PID"')) {
					if (_isRoot) {
						restartable.push({
							label: 'Launchd Service (macOS)',
							restart: () => {
								try { execSync(`launchctl stop ${LAUNCHD_LBL}`, { stdio: 'ignore' }); } catch { }
								execSync(`launchctl start ${LAUNCHD_LBL}`, { stdio: 'ignore' });
							}
						});
					} else {
						locked.push('Launchd Service (requires root)');
					}
				}
			} catch (err: any) { debugLog(`Launchd check failed: ${err.message}`); }
		}

		const totalDetected = restartable.length + locked.length;
		if (totalDetected > 0) {
			const restartableLines = restartable.map(s => `  \x1b[33m•\x1b[0m ${s.label}`);
			const lockedLines = locked.map(s => `  \x1b[31m• ${s} — restart manually\x1b[0m`);

			// Always show locked services as a warning BEFORE any interactive prompt
			if (locked.length > 0) {
				console.log(`\n\x1b[33m[!] The following services are running but cannot be restarted without elevated privileges:\x1b[0m\n${lockedLines.join('\n')}`);
			}

			if (restartable.length > 0) {
				const restartableList = restartableLines.join('\n');
				const promptHeader = `\nThe following services can be restarted now:\n${restartableList}\n\nWould you like to restart them?`;
				const restartAction = await selectPrompt(promptHeader, [
					{ label: 'Yes, restart now', value: 'yes' },
					{ label: 'No, I will restart them manually', value: 'no' }
				]);
				if (restartAction === 'yes') {
					console.clear();
					for (const svc of restartable) {
						try {
							console.log(`Restarting ${svc.label}...`);
							svc.restart();
							console.log(`\x1b[32m✓ ${svc.label} restarted.\x1b[0m`);
						} catch (e: any) {
							console.log(`\x1b[31m✗ Failed to restart ${svc.label}: ${e.message}\x1b[0m`);
						}
					}
				}
			}
		}

		const cliRestartAction = await selectPrompt('\nWould you like to restart the CLI to apply the update?', [
			{ label: 'Yes, restart CLI now', value: 'yes' },
			{ label: 'No, go back to main menu', value: 'no' }
		]);

		if (cliRestartAction === 'no') {
			return;
		}

		console.log('\n\x1b[36mRestarting CDDS CLI to apply changes...\x1b[0m');
		await new Promise(resolve => setTimeout(resolve, 1000));
		console.clear();
		
		const { spawnSync } = await import('node:child_process');
		const rt = detectRuntime();
		const _execPath = rt.execPath;
		const _args = rt.serviceArgs ? [...rt.serviceArgs.split(' '), process.argv[1]] : [process.argv[1]];
		debugLog(`Spawning: ${_execPath} ${_args.join(' ')}`);
		
		const child = spawnSync(_execPath, _args, { stdio: 'inherit' });
		
		if (child.error) {
			debugLog(new Error(`spawnSync error: ${child.error.message}`));
			await pausePrompt();
		} else if (child.status !== 0) {
			debugLog(new Error(`Child exited with status ${child.status}`));
			await pausePrompt();
		}
		
		process.exit(0);
	} catch (err: any) {
		console.error(`\x1b[31mFailed to check for updates: ${err.message}\x1b[0m`);
		await pausePrompt();
	}
};


// --- MAIN CLI ENTRY POINT ---
const main = async () => {
	// Parse global flags like --env or --debug
	while (true) {
		const envArgIndex = process.argv.findIndex(arg => arg === '--env' || arg === '-e');
		if (envArgIndex !== -1 && process.argv[envArgIndex + 1]) {
			process.argv.splice(envArgIndex, 2);
			continue;
		}
		
		const debugArgIndex = process.argv.findIndex(arg => arg === '--debug' || arg === '-d');
		if (debugArgIndex !== -1) {
			process.env.CDDS_DEBUG = 'true';
			process.argv.splice(debugArgIndex, 1);
			continue;
		}
		
		break;
	}

	const args = process.argv.slice(2);
	const command = args[0];

	if (command === 'start') {
		try {
			await startDaemon();
		} catch (err) {
			console.error(err);
			process.exit(1);
		}
		return;
	} else if (command === 'daemon') {
		const existingPid = await (async () => {
			try {
				if (await fileExists(getPidFile())) return parseInt(await fsPromises.readFile(getPidFile(), 'utf8'), 10);
			} catch { }
			return null;
		})();

		if (existingPid) {
			try {
				process.kill(existingPid, 0);
				console.error(`CDDS daemon is already running (PID: ${existingPid}). Use 'cdds stop' first.`);
				process.exit(1);
			} catch {
				await fsPromises.writeFile(getPidFile(), '', "utf8");
			}
		}

		const bunExec = process.execPath;
		const scriptPath = import.meta.url ? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') : process.argv[1];

		let pid: number;
		if (isWindows) {
			const psCmd = `(Start-Process -FilePath '${bunExec}' -ArgumentList '"${scriptPath}"', 'start' -WindowStyle Hidden -PassThru).Id`;
			const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8' });
			pid = parseInt(out.trim(), 10);
		} else {
			const child = spawn(bunExec, [scriptPath, 'start'], {
				detached: true,
				stdio: ['ignore', 'ignore', 'ignore'],
				env: { ...process.env },
			});
			child.unref();
			pid = child.pid!;
		}

		await fsPromises.writeFile(getPidFile(), pid.toString(), "utf8");

		console.log(`CDDS daemon started in background (PID: ${pid})`);
		console.log(`PID saved to: ${getPidFile()}`);
		console.log(`Use 'cdds status' to check, 'cdds stop' to stop.`);
		return;
	} else if (command === 'stop') {
		try {
			if (!(await fileExists(getPidFile()))) {
				console.error("No PID file found. CDDS daemon does not appear to be running.");
				process.exit(1);
			}
			const pid = parseInt(await fsPromises.readFile(getPidFile(), 'utf8'), 10);
			if (!pid || isNaN(pid)) {
				console.error("Invalid PID file. Try removing cdds.pid manually.");
				process.exit(1);
			}
			process.kill(pid, 'SIGTERM');
			await fsPromises.writeFile(getPidFile(), '', "utf8");
			console.log(`CDDS daemon stopped (PID: ${pid}).`);
		} catch (err: any) {
			if (err.code === 'EPERM') {
				console.error("Failed to stop daemon: Process is locked by another user (likely root). Try 'sudo cdds stop'.");
				process.exit(1);
			} else if (err.code === 'ESRCH') {
				console.log("CDDS daemon is not running (stale PID file found).");
				try {
					await fsPromises.writeFile(getPidFile(), '', "utf8");
					console.log("Stale PID file cleaned up successfully.");
				} catch (cleanErr: any) {
					console.log("Failed to clean up stale PID file. You may need to use 'sudo' to clean it.");
				}
			} else {
				console.error(`Failed to stop daemon: ${err.message}`);
				process.exit(1);
			}
		}
		return;
	} else if (command === 'status') {
		try {
			if (!(await fileExists(getPidFile()))) {
				console.log("CDDS daemon: NOT running (no PID file found).");
				process.exit(0);
			}
			const pid = parseInt(await fsPromises.readFile(getPidFile(), 'utf8'), 10);
			if (!pid || isNaN(pid)) {
				console.log("CDDS daemon: NOT running (invalid PID file).");
				process.exit(0);
			}
			try {
				process.kill(pid, 0);
				console.log(`CDDS daemon: RUNNING (PID: ${pid})`);
			} catch (err: any) {
				if (err.code === 'EPERM') {
					console.log(`CDDS daemon: RUNNING (PID: ${pid}) [Requires Sudo to manage]`);
				} else {
					console.log(`CDDS daemon: NOT running (stale PID: ${pid}).`);
					try { await fsPromises.writeFile(getPidFile(), '', "utf8"); } catch {}
				}
			}
		} catch (err: any) {
			console.error(`Status check failed: ${err.message}`);
			process.exit(1);
		}
		return;
	} else if (command === 'version' || command === '--version' || command === '-v') {
		try {
			let pkgPath = new URL('../package.json', import.meta.url);
			let fileContent = '';
			try {
				fileContent = await fsPromises.readFile(pkgPath, 'utf8');
			} catch {
				pkgPath = new URL('./package.json', import.meta.url);
				fileContent = await fsPromises.readFile(pkgPath, 'utf8');
			}
			const pkg = JSON.parse(fileContent);
			console.log(`v${pkg.version}`);
		} catch (err) {
			console.log('v1.5.0'); // Fallback if package.json is missing
		}
		return;
	} else if (command === 'upgrade') {
		await checkForUpdates();
		return;
	} else if (command === 'help' || command === '--help' || command === '-h') {
		console.log(`
Cloudflare Dynamic DNS Service (CDDS)

Usage:

  cdds              Open interactive service manager (UI)
  cdds start        Run daemon in foreground (blocks terminal)
  cdds daemon       Run daemon in background (detached)
  cdds stop         Stop background daemon
  cdds status       Check if background daemon is running
  cdds upgrade      Check for updates and optionally upgrade
  cdds version      Show version information (-v, --version)
  cdds help         Show this help message
`);
		return;
	}

	// Interactive Mode
	let view = 'menu';
	
	const pm2Available = isPM2Available();
	const systemdAvailable = isSystemdAvailable();
	const isMacOS = process.platform === 'darwin';
	
	while (true) {
		const existingConfig = await parseEnv();
		let configError = '';
		if (existingConfig) {
			try {
				validateConfig(existingConfig);
			} catch (e: any) {
				configError = e.message;
			}
		}
		const isConfigValid = !!(existingConfig && !configError);
		
		if (view === 'menu') {
			const menuItems = [
				{ label: existingConfig ? 'Edit existing configuration' : 'Run configuration wizard', value: 'env' },
				{ label: 'Manage Daemon (built-in)', value: 'daemon' },
				...(systemdAvailable ? [{ label: `Manage Systemd Service${!_isRoot ? ' (requires root)' : ''}`, value: 'systemd', disabled: !_isRoot }] : []),
				...(isMacOS ? [{ label: `Manage Launchd Service (macOS)${!_isRoot ? ' (requires root)' : ''}`, value: 'launchd', disabled: !_isRoot }] : []),
				...(isWindows ? [{ label: `Manage Windows Task Scheduler${!_isAdmin ? ' (requires Administrator)' : ''}`, value: 'taskscheduler', disabled: !_isAdmin }] : []),
				...(pm2Available ? [{ label: 'Manage PM2 Service', value: 'pm2' }] : []),
				{ label: 'Check for updates', value: 'update' },
				{ label: 'Exit', value: 'exit' }
			];
			
			let configPathStr = '';
			const isCustomEnv = !!process.env.CDDS_ENV_PATH;
			const currentEnvPath = getEnvPath();

			if (existingConfig) {
				if (configError) {
					configPathStr = `\x1b[31mConfig: ${currentEnvPath} (Missing required fields)\x1b[0m\n`;
				} else {
					configPathStr = `\x1b[90mConfig: ${currentEnvPath}\x1b[0m\n`;
				}
			} else if (isCustomEnv) {
				let accessError: any = null;
				try {
					await fsPromises.access(currentEnvPath, (await import('fs')).constants.R_OK);
				} catch (e) {
					accessError = e;
				}
				
				if (accessError) {
					if (accessError.code === 'ENOENT') {
						configPathStr = `\x1b[90mConfig: ${currentEnvPath} (File does not exist)\x1b[0m\n`;
					} else {
						configPathStr = `\x1b[31mConfig: ${currentEnvPath} (Permission denied / Access error)\x1b[0m\n`;
					}
				} else {
					configPathStr = `\x1b[31mConfig: ${currentEnvPath} (Invalid format)\x1b[0m\n`;
				}
			}

			const debugTag = process.env.CDDS_DEBUG === 'true' ? ' \x1b[33m[DEBUG MODE]\x1b[0m' : '';
			
			const rt = detectRuntime();
			const sudoTag = rt.isSudo ? ' \x1b[32m[SUDO]\x1b[0m' : '';
			const sudoWarning = (rt.isSudo && !existingConfig) ? `\x1b[33m[!] WARNING: Sudo detected but config was not found.\n    If you rely on local environment variables (like CDDS_ENV_PATH), they may have been wiped.\n    Recommendation: Use "sudo -E cdds" to preserve them.\x1b[0m\n\n` : '';
			
			const header = `\x1b[34m\x1b[1mCloudflare Dynamic DNS Service (CDDS)\x1b[0m${debugTag}${sudoTag}\n` + 
				configPathStr +
				'\n' + sudoWarning + 'Select an action:';
			const action = await selectPrompt(header, menuItems);
			if (action === 'exit') break;
			view = action;
		} else if (view === 'env') {
			const nextAction = await runEnvWizard(existingConfig);
			view = nextAction;
		} else if (view === 'install_prompt') {
			const action = await selectPrompt('Which service manager would you like to use?', [
				...(systemdAvailable ? [{ label: `Systemd (Debian/Ubuntu)${!_isRoot ? ' (requires root)' : ''}`, value: 'systemd', disabled: !_isRoot }] : []),
				...(isMacOS ? [{ label: `Launchd (macOS LaunchDaemon)${!_isRoot ? ' (requires root)' : ''}`, value: 'launchd', disabled: !_isRoot }] : []),
				...(isWindows ? [{ label: `Windows Task Scheduler${!_isAdmin ? ' (requires Administrator)' : ''}`, value: 'taskscheduler', disabled: !_isAdmin }] : []),
				...(pm2Available ? [{ label: 'PM2 (detected in PATH)', value: 'pm2' }] : []),
				{ label: 'Nevermind, return to main menu', value: 'menu' }
			]);
			view = action;
		} else if (view === 'daemon') {
			await runDaemonManager();
			view = 'menu';
		} else if (view === 'taskscheduler') {
			await runTaskSchedulerManager();
			view = 'menu';
		} else if (view === 'systemd') {
			await runSystemdManager();
			view = 'menu';
		} else if (view === 'pm2') {
			await runPM2Manager();
			view = 'menu';
		} else if (view === 'launchd') {
			await runLaunchdManager();
			view = 'menu';
		} else if (view === 'update') {
			await checkForUpdates();
			view = 'menu';
		}
	}
};

if (process.env.NODE_ENV !== 'test' && process.env.BUN_ENV !== 'test') {
	main().catch(console.error);
}
