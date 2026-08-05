#!/usr/bin/env node
import process from 'process';
import { execSync as nodeExecSync, spawn } from 'child_process';
import { promises as fsPromises } from 'node:fs';
import { appendFileSync, writeFileSync, unlinkSync } from 'fs';
import { resolve, dirname } from 'path';

const execSync = (cmd: string, options: any = {}) => {
	return nodeExecSync(cmd, { windowsHide: true, ...options });
};
import * as readline from 'readline';

import datr from 'datr';
import { startDaemon, validateConfig, type CloudflareConfig, detectApiKeyType } from './main.ts';

const isWindows = process.platform === 'win32';

const getEnvPath = () => process.env.CDDS_ENV_PATH ? resolve(process.env.CDDS_ENV_PATH) : resolve(process.cwd(), '.env');
const getLogDir = () => dirname(getEnvPath());

const PID_FILE = resolve(getLogDir(), 'cdds.pid');

const fileExists = async (path: string) => { try { await fsPromises.access(path); return true; } catch { return false; } };

const logMessage = (msg: string) => {
	const line = `[${datr({ precision: 'ms', separator: '-' })}] ${msg}\n`;
	try { appendFileSync(resolve(getLogDir(), 'cli-manager.log'), line); } catch (e) {}
};

// Console UI Helpers (Zero Dependencies)
const clearScreen = () => {
	process.stdout.write('\x1Bc');
};

const textPrompt = (question: string, defaultValue: string = ''): Promise<string> => {
	return new Promise((resolve) => {
		const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
		rl.question(`${question} ${defaultValue ? `(${defaultValue}) ` : ''}`, (answer) => {
			rl.close();
			resolve(answer.trim() || defaultValue);
		});
	});
};

type SelectItem = { label: string; value: string; disabled?: boolean };
const selectPrompt = (question: string, items: SelectItem[], defaultIndex: number = 0): Promise<string> => {
	return new Promise((resolve) => {
		// If the default index lands on a disabled item, find the first enabled one
		const firstEnabled = items.findIndex((item) => !item.disabled);
		let selectedIndex = items[defaultIndex]?.disabled ? (firstEnabled >= 0 ? firstEnabled : 0) : defaultIndex;
		let rl: readline.Interface | null = null;
		
		const renderMenu = () => {
			process.stdout.write('\x1B[2J\x1B[0;0H'); // Clear and move to top
			console.log(`\x1b[36m\x1b[1m${question}\x1b[0m\n`);
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
			if (key.name === 'up') {
				moveCursor(-1);
				renderMenu();
			} else if (key.name === 'down') {
				moveCursor(1);
				renderMenu();
			} else if (key.name === 'return' || key.name === 'enter') {
				if (items[selectedIndex].disabled) return; // safety guard
				cleanup();
				resolve(items[selectedIndex].value);
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
			items.forEach((item, i) => console.log(`${i + 1}. ${item.label}${item.disabled ? ' (unavailable)' : ''}`));
			rl.question('Select option number: ', (answer) => {
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
				const trimmedKey = key.trim();
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
			logs: env.CDDS_LOGS !== 'false',
			dryRun: false,
			ipLogFile: env.CDDS_IP_LOGFILE || 'true',
			ipType: ['ipv4', 'ipv6', 'both'].includes(env.CDDS_IP_TYPE?.toLowerCase() || '') ? env.CDDS_IP_TYPE!.toLowerCase() as any : 'ipv4',
			proxied: env.CDDS_PROXIED === 'true'
		};
	} catch (e) {
		return null;
	}
};

// --- WIZARD ---
const runEnvWizard = async (initialConfig: CloudflareConfig | null) => {
	let apiKey = initialConfig?.apiKey || '';
	let email = initialConfig?.email || '';
	let targets = initialConfig?.targets.join(', ') || '';
	let zoneId = initialConfig?.zoneId || '';
	let ttl = initialConfig?.ttl?.toString() || '60';
	let interval = initialConfig?.checkIntervalMinutes?.toString() || '5';
	let ipType = initialConfig?.ipType || 'ipv4';
	let logs = initialConfig?.logs !== false ? 'true' : 'false';
	let ipLogFile = (initialConfig?.ipLogFile || 'true').toString();
	let proxied = initialConfig?.proxied ? 'true' : 'false';

	clearScreen();
	console.log('\x1b[36m\x1b[1m--- .ENV CONFIGURATION WIZARD ---\x1b[0m\n');
	
	apiKey = await textPrompt('Cloudflare API Key / Token:', apiKey);
	email = await textPrompt('Cloudflare Email (Leave empty if using Token):', email);
	targets = await textPrompt('Targets (comma separated, e.g. sub.domain.com):', targets);
	zoneId = await textPrompt('Zone ID (Optional, leave empty for auto-discover):', zoneId);
	ttl = await textPrompt('TTL in seconds:', ttl);
	interval = await textPrompt('Check interval in minutes:', interval);
	ipType = await selectPrompt('IP Type to update:', [
		{ label: 'IPv4 (A)', value: 'ipv4' },
		{ label: 'IPv6 (AAAA)', value: 'ipv6' },
		{ label: 'Both (A + AAAA)', value: 'both' }
	], ipType === 'both' ? 2 : (ipType === 'ipv6' ? 1 : 0)) as any;

	proxied = await selectPrompt('Enable Cloudflare Proxy (Orange Cloud)?', [
		{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
	], proxied === 'false' ? 1 : 0);

	let actionLogFile = 'false';
	const masterLogs = await selectPrompt('Do you want to enable logging?', [
		{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
	], logs === 'false' ? 1 : 0);

	if (masterLogs === 'true') {
		logs = await selectPrompt('Log everything to the terminal (console)?', [
			{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
		], logs === 'false' ? 1 : 0);
		actionLogFile = await selectPrompt('Log all actions to a file (cdds-actions.log)?', [
			{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
		]);
		ipLogFile = await selectPrompt('Log new IP addresses to a file (cdds-ip.log)?', [
			{ label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
		], ipLogFile === 'false' ? 1 : 0);
	} else {
		logs = 'false';
		actionLogFile = 'false';
		ipLogFile = 'false';
	}

	let existingLines: string[] = [];
	const envPath = getEnvPath();
	try {
		const text = await fsPromises.readFile(envPath, 'utf8');
		existingLines = text.split(/\r?\n/).filter(line => !line.trim().startsWith('CDDS_'));
		// Remove trailing empty lines to prevent newline accumulation
		while (existingLines.length > 0 && existingLines[existingLines.length - 1].trim() === '') {
			existingLines.pop();
		}
	} catch { }

	let envContent = existingLines.length > 0 ? existingLines.join('\n') + '\n\n' : '';
	envContent += `CDDS_API_KEY=${apiKey}\n`;
	if (email) envContent += `CDDS_EMAIL=${email}\n`;
	envContent += `CDDS_TARGETS=${targets}\n`;
	if (zoneId) envContent += `CDDS_ZONE_ID=${zoneId}\n`;
	envContent += `CDDS_TTL=${ttl}\n`;
	envContent += `CDDS_CHECK_INTERVAL=${interval}\n`;
	envContent += `CDDS_IP_TYPE=${ipType}\n`;
	envContent += `CDDS_PROXIED=${proxied}\n`;
	envContent += `CDDS_LOGS=${logs}\n`;
	envContent += `CDDS_ACTION_LOGFILE=${actionLogFile}\n`;
	envContent += `CDDS_IP_LOGFILE=${ipLogFile}\n`;

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
};

// --- SERVICE MANAGERS ---
const isPM2Available = (): boolean => {
	try { execSync(isWindows ? 'where pm2' : 'which pm2', { stdio: 'ignore' }); return true; } catch { return false; }
};

const isSystemdAvailable = (): boolean => {
	if (isWindows) return false;
	try { execSync('systemctl --version', { stdio: 'ignore' }); return true; } catch { return false; }
};

const isWindowsAdmin = (): boolean => {
	if (!isWindows) return false;
	try { execSync('net session', { stdio: 'ignore' }); return true; } catch { return false; }
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
		const statusRaw = getSystemdStatus();
		const notInstalled = statusRaw === 'Not Installed';
		const isRunning = statusRaw.startsWith('Running');
		const isFailed = statusRaw === 'Failed';
		
		let statusColor = '\x1b[33m';
		if (isRunning) statusColor = '\x1b[32m';
		if (notInstalled || isFailed) statusColor = '\x1b[31m';

		const items = [
			...(notInstalled ? [{ label: 'Install & Start Service (Systemd)', value: 'install' }] : []),
			...(!notInstalled && isRunning ? [{ label: 'Reload (restart with latest config)', value: 'reload' }] : []),
			...(!notInstalled && isRunning ? [{ label: 'Stop Service', value: 'pause' }] : []),
			...(!notInstalled && !isRunning ? [{ label: 'Start Service', value: 'resume' }] : []),
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
				const bunPath = process.execPath;
				const serviceContent = `[Unit]
Description=Cloudflare Dynamic DNS Service
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=${projectPath}
ExecStart=${bunPath} run cdds start
Restart=on-failure
RestartSec=10
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
			const raw = execSync('pm2 jlist', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
			const list: PM2Process[] = JSON.parse(raw);
			return list.find(p => p.name === PM2_SERVICE_NAME) || null;
		} catch (e: any) {
			if (e.message?.includes('EPERM') || e.stderr?.includes('EPERM')) {
				throw new Error('EPERM: Cannot connect to PM2 daemon.\n\nThe PM2 daemon was started by a different process or user.\nRun \x1b[33mpm2 kill\x1b[0m in your terminal and try again.');
			}
			return null;
		}
	};

	while (true) {
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
			...(notInstalled && !pm2Error ? [{ label: 'Install & Start Service (PM2)', value: 'install' }] : []),
			...(!notInstalled && isOnline ? [{ label: 'Reload (restart with latest config)', value: 'reload' }] : []),
			...(!notInstalled && isOnline ? [{ label: 'Stop Service', value: 'pause' }] : []),
			...(!notInstalled && isStopped ? [{ label: 'Start Service', value: 'resume' }] : []),
			...(!notInstalled ? [{ label: 'Uninstall / Remove Service', value: 'remove' }] : []),
			...(!pm2Error ? [{ label: 'Save Services (pm2 save)', value: 'save' }] : []),
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
				const bunExec = process.execPath;
				const scriptPath = import.meta.url ? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') : process.argv[1];

				const pm2Content = `module.exports = {\n  apps: [\n    {\n      name: "${PM2_SERVICE_NAME}",\n      script: "${scriptPath.replace(/\\/g, '/')}",\n      args: "start",\n      interpreter: "${bunExec.replace(/\\/g, '/')}",\n      instances: 1,\n      autorestart: true,\n      watch: false,\n      cwd: "${getLogDir().replace(/\\/g, '/')}",\n      max_memory_restart: "100M",\n      env: { NODE_ENV: "production" },\n    },\n  ],\n};\n`;
				const pm2ConfigPath = resolve(getLogDir(), 'pm2.config.cjs');
				await fsPromises.writeFile(pm2ConfigPath, pm2Content, "utf8");
				execSync(`pm2 start "${pm2ConfigPath}"`);
				execSync('pm2 save');
				console.log('\x1b[32mSUCCESS: PM2 Service installed and started successfully!\x1b[0m');
				logMessage(`PM2: Installed and started ${PM2_SERVICE_NAME}`);
			} else if (action === 'reload') {
				const bunExec = process.execPath;
				const scriptPath = import.meta.url ? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') : process.argv[1];
				const pm2Content = `module.exports = {\n  apps: [\n    {\n      name: "${targetName}",\n      script: "${scriptPath.replace(/\\/g, '/')}",\n      args: "start",\n      interpreter: "${bunExec.replace(/\\/g, '/')}",\n      instances: 1,\n      autorestart: true,\n      watch: false,\n      cwd: "${getLogDir().replace(/\\/g, '/')}",\n      max_memory_restart: "100M",\n      env: { NODE_ENV: "production" },\n    },\n  ],\n};\n`;
				const pm2ConfigPath = resolve(getLogDir(), 'pm2.config.cjs');
				await fsPromises.writeFile(pm2ConfigPath, pm2Content, "utf8");
				execSync(`pm2 start "${pm2ConfigPath}"`);
				execSync('pm2 save');
				console.log('\x1b[32mSUCCESS: PM2 Service restarted and updated with latest config.\x1b[0m');
				logMessage(`PM2: Reloaded ${targetName}`);
			} else if (action === 'pause') {
				execSync(`pm2 stop "${targetName}"`);
				console.log('\x1b[32mSUCCESS: PM2 Service stopped.\x1b[0m');
				logMessage(`PM2: Stopped ${targetName}`);
			} else if (action === 'resume') {
				execSync(`pm2 start "${targetName}"`);
				console.log('\x1b[32mSUCCESS: PM2 Service started.\x1b[0m');
				logMessage(`PM2: Started ${targetName}`);
			} else if (action === 'save') {
				execSync('pm2 save');
				console.log('\x1b[32mSUCCESS: PM2 Services saved (will restore on boot if pm2 startup is configured).\x1b[0m');
				logMessage(`PM2: Saved process list`);
			} else if (action === 'remove') {
				execSync(`pm2 delete "${targetName}"`);
				execSync('pm2 save');
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
			...(notInstalled ? [{ label: 'Install & Start Service (Task Scheduler)', value: 'install' }] : []),
			...(!notInstalled ? [{ label: 'Reload (restart with latest config)', value: 'reload' }] : []),
			...(!notInstalled && taskStatus !== 'Disabled' ? [{ label: 'Stop Service', value: 'pause' }] : []),
			...(!notInstalled && taskStatus !== 'Running' && taskStatus !== 'Ready' ? [{ label: 'Start Service', value: 'resume' }] : []),
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
				const execPath = process.execPath.replace(/\//g, '\\');
				const scriptPath = (import.meta.url
					? new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
					: process.argv[1]
				).replace(/\//g, '\\');
				const workDir = getLogDir().replace(/\//g, '\\');

				// Build task XML — avoids all quoting/escaping issues with spaces in paths
				const taskXml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Cloudflare Dynamic DNS Service - keeps DNS records in sync with your public IP</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </BootTrigger>
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
      <Arguments>"${scriptPath}" start</Arguments>
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
			return 'Not Installed';
		}
	};

	while (true) {
		const statusRaw = getLaunchdStatus();
		const notInstalled = statusRaw === 'Not Installed';
		const isRunning = statusRaw.startsWith('Running');
		const statusColor = isRunning ? '\x1b[32m' : (notInstalled ? '\x1b[31m' : '\x1b[33m');

		const items = [
			...(notInstalled ? [{ label: 'Install & Start Service (LaunchDaemon)', value: 'install' }] : []),
			...(!notInstalled && isRunning ? [{ label: 'Reload (restart with latest config)', value: 'reload' }] : []),
			...(!notInstalled && isRunning ? [{ label: 'Stop Service', value: 'stop' }] : []),
			...(!notInstalled && !isRunning ? [{ label: 'Start Service', value: 'start' }] : []),
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

			const execPath = process.execPath;
			const scriptPath = import.meta.url
				? new URL(import.meta.url).pathname
				: process.argv[1];
			const workDir = getLogDir();
			const envPath = getEnvPath();

			if (action === 'install') {
				// Ensure LaunchDaemons dir exists
				await fsPromises.mkdir(systemLaunchDaemonsDir, { recursive: true });

				const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
    <string>${scriptPath}</string>
    <string>start</string>
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
				const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${execPath}</string>
    <string>${scriptPath}</string>
    <string>start</string>
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
		let running = false;
		let pid: number | null = null;
		
		try {
			if (await fileExists(PID_FILE)) {
				const stored = parseInt(await fsPromises.readFile(PID_FILE, 'utf8'), 10);
				if (stored && !isNaN(stored)) {
					try {
						process.kill(stored, 0);
						pid = stored;
						running = true;
					} catch {
						await fsPromises.writeFile(PID_FILE, '', "utf8");
					}
				}
			}
		} catch {}

		const items = [
			...(!running ? [{ label: 'Start Daemon (background)', value: 'start' }] : []),
			...(running ? [{ label: 'Reload Daemon (restart with latest config)', value: 'reload' }] : []),
			...(running ? [{ label: 'Stop Daemon', value: 'stop' }] : []),
			{ label: 'Refresh Status', value: 'refresh' },
			{ label: 'Go Back', value: 'back' },
		];

		const action = await selectPrompt(`--- DAEMON MANAGER (Built-in) ---\nStatus: ${running ? '\x1b[32mRunning\x1b[0m (PID: ' + pid + ')' : '\x1b[31mStopped\x1b[0m'}`, items);


		if (action === 'back') break;
		if (action === 'refresh') continue;

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
				
				await fsPromises.writeFile(PID_FILE, childPid.toString(), "utf8");
				logMessage(`Daemon: Started (PID: ${childPid})`);
				console.log(`\x1b[32mSUCCESS: Daemon started! (PID: ${childPid})\x1b[0m`);
			} else if (action === 'stop') {
				if (!running || !pid) throw new Error('Daemon is not running.');
				process.kill(pid, 'SIGTERM');
				await fsPromises.writeFile(PID_FILE, '', "utf8");
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
				
				await fsPromises.writeFile(PID_FILE, childPid.toString(), "utf8");
				logMessage(`Daemon: Reloaded (old PID: ${pid}, new PID: ${childPid})`);
				console.log(`\x1b[32mSUCCESS: Daemon reloaded! (old PID: ${pid} → new PID: ${childPid})\x1b[0m`);
			}
		} catch (e: any) {
			if (e.code === 'ESRCH') {
				await fsPromises.writeFile(PID_FILE, '', "utf8");
				console.log('\x1b[32mSUCCESS: Daemon was not running (stale PID removed).\x1b[0m');
			} else {
				console.log(`\x1b[31mERROR: ${e.message}\x1b[0m`);
			}
		}
		await pausePrompt();
	}
};

// --- MAIN CLI ENTRY POINT ---
const main = async () => {
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
				if (await fileExists(PID_FILE)) return parseInt(await fsPromises.readFile(PID_FILE, 'utf8'), 10);
			} catch { }
			return null;
		})();

		if (existingPid) {
			try {
				process.kill(existingPid, 0);
				console.error(`CDDS daemon is already running (PID: ${existingPid}). Use 'cdds stop' first.`);
				process.exit(1);
			} catch {
				await fsPromises.writeFile(PID_FILE, '', "utf8");
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

		await fsPromises.writeFile(PID_FILE, pid.toString(), "utf8");

		console.log(`CDDS daemon started in background (PID: ${pid})`);
		console.log(`PID saved to: ${PID_FILE}`);
		console.log(`Use 'cdds status' to check, 'cdds stop' to stop.`);
		return;
	} else if (command === 'stop') {
		try {
			if (!(await fileExists(PID_FILE))) {
				console.error("No PID file found. CDDS daemon does not appear to be running.");
				process.exit(1);
			}
			const pid = parseInt(await fsPromises.readFile(PID_FILE, 'utf8'), 10);
			if (!pid || isNaN(pid)) {
				console.error("Invalid PID file. Try removing cdds.pid manually.");
				process.exit(1);
			}
			process.kill(pid, 'SIGTERM');
			await fsPromises.writeFile(PID_FILE, '', "utf8");
			console.log(`CDDS daemon stopped (PID: ${pid}).`);
		} catch (err: any) {
			if (err.code === 'ESRCH') {
				console.log("CDDS daemon is not running (stale PID file removed).");
				await fsPromises.writeFile(PID_FILE, '', "utf8");
			} else {
				console.error(`Failed to stop daemon: ${err.message}`);
				process.exit(1);
			}
		}
		return;
	} else if (command === 'status') {
		try {
			if (!(await fileExists(PID_FILE))) {
				console.log("CDDS daemon: NOT running (no PID file found).");
				process.exit(0);
			}
			const pid = parseInt(await fsPromises.readFile(PID_FILE, 'utf8'), 10);
			if (!pid || isNaN(pid)) {
				console.log("CDDS daemon: NOT running (invalid PID file).");
				process.exit(0);
			}
			try {
				process.kill(pid, 0);
				console.log(`CDDS daemon: RUNNING (PID: ${pid})`);
			} catch {
				console.log(`CDDS daemon: NOT running (stale PID: ${pid}).`);
				await fsPromises.writeFile(PID_FILE, '', "utf8");
			}
		} catch (err: any) {
			console.error(`Status check failed: ${err.message}`);
			process.exit(1);
		}
		return;
	} else if (command === 'version' || command === '--version' || command === '-v') {
		try {
			const pkgPath = new URL('../package.json', import.meta.url);
			const pkg = JSON.parse(await fsPromises.readFile(pkgPath, 'utf8'));
			console.log(`v${pkg.version}`);
		} catch (err) {
			console.log('v1.5.0'); // Fallback if package.json is missing
		}
		return;
	} else if (command === 'help' || command === '--help' || command === '-h') {
		console.log(`
CDDS - Cloudflare Dynamic DNS Service

Usage:
  cdds              Open interactive service manager (UI)
  cdds start        Run daemon in foreground (blocks terminal)
  cdds daemon       Run daemon in background (detached)
  cdds stop         Stop background daemon
  cdds status       Check if background daemon is running
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
		
		if (view === 'menu') {
			const menuItems = [
				{ label: existingConfig ? 'Edit existing .env Configuration' : 'Run .env Configuration Wizard', value: 'env' },
				{ label: 'Manage Daemon (built-in)', value: 'daemon' },
				...(systemdAvailable ? [{ label: `Manage Systemd Service${!_isRoot ? ' (requires root)' : ''}`, value: 'systemd', disabled: !_isRoot }] : []),
				...(isMacOS ? [{ label: `Manage Launchd Service (macOS)${!_isRoot ? ' (requires root)' : ''}`, value: 'launchd', disabled: !_isRoot }] : []),
				...(isWindows ? [{ label: `Manage Windows Task Scheduler${!_isAdmin ? ' (requires Administrator)' : ''}`, value: 'taskscheduler', disabled: !_isAdmin }] : []),
				...(pm2Available ? [{ label: 'Manage PM2 Service', value: 'pm2' }] : []),
				{ label: 'Exit', value: 'exit' }
			];
			
			const action = await selectPrompt('\x1b[34m\x1b[1mCloudflare Dynamic DNS Service (CDDS)\x1b[0m\n\nSelect an action:', menuItems);
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
		}
	}
};

main().catch(console.error);
