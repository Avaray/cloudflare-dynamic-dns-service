#!/usr/bin/env bun
import React, { useState, useEffect } from 'react';
import { render, Box, Text, useApp, Newline } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import process from 'process';
import { execSync } from 'child_process';
import { appendFileSync } from 'fs';
import { startDaemon, validateConfig, type CloudflareConfig, detectApiKeyType } from './main.ts';

const logMessage = (msg: string) => {
	const timestamp = new Date().toISOString();
	const line = `[${timestamp}] ${msg}\n`;
	try {
		appendFileSync(process.cwd() + '/cli-manager.log', line);
	} catch (e) {}
};

const parseEnv = async (): Promise<CloudflareConfig | null> => {
	try {
		const envFile = Bun.file(process.cwd() + '/.env');
		if (!(await envFile.exists())) return null;
		const text = await envFile.text();
		const lines = text.split('\n');
		const env: Record<string, string> = {};
		for (const line of lines) {
			const [key, ...rest] = line.split('=');
			if (key && rest.length > 0) {
				env[key.trim()] = rest.join('=').trim();
			}
		}
		
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
			ipLogFile: env.CDDS_IP_LOGFILE || 'true'
		};
	} catch (e) {
		return null;
	}
};

const EnvWizard = ({ onComplete, initialConfig }: { onComplete: (installNow: boolean) => void, initialConfig: CloudflareConfig | null }) => {
	const [step, setStep] = useState(0);
	const [config, setConfig] = useState({
		apiKey: initialConfig?.apiKey || '',
		email: initialConfig?.email || '',
		targets: initialConfig?.targets.join(', ') || '',
		zoneId: initialConfig?.zoneId || '',
		ttl: initialConfig?.ttl?.toString() || '60',
		interval: initialConfig?.checkIntervalMinutes?.toString() || '5',
		logs: initialConfig?.logs !== false ? 'true' : 'false',
		ipLogFile: (initialConfig?.ipLogFile || 'true').toString()
	});

	const steps = [
		{ key: 'apiKey', label: 'Cloudflare API Key / Token:', type: 'text' },
		{ key: 'email', label: 'Cloudflare Email (Leave empty if using Token):', type: 'text' },
		{ key: 'targets', label: 'Targets (comma separated, e.g. sub.domain.com):', type: 'text' },
		{ key: 'zoneId', label: 'Zone ID (Optional, leave empty for auto-discover):', type: 'text' },
		{ key: 'ttl', label: 'TTL in seconds (default 60):', type: 'text' },
		{ key: 'interval', label: 'Check interval in minutes (default 5):', type: 'text' },
		{ key: 'logs', label: 'Enable console logs?', type: 'bool' },
		{ key: 'ipLogFile', label: 'Enable IP log file?', type: 'bool' }
	];

	const currentStep = steps[step];

	const handleNext = async (value: string) => {
		if (!currentStep) return;
		const key = currentStep.key as keyof typeof config;
		const newConfig = { ...config, [key]: value };
		setConfig(newConfig);

		if (step < steps.length - 1) {
			setStep(step + 1);
		} else {
			setStep(steps.length);
			let envContent = `CDDS_API_KEY=${newConfig.apiKey}\n`;
			if (newConfig.email) envContent += `CDDS_EMAIL=${newConfig.email}\n`;
			envContent += `CDDS_TARGETS=${newConfig.targets}\n`;
			if (newConfig.zoneId) envContent += `CDDS_ZONE_ID=${newConfig.zoneId}\n`;
			envContent += `CDDS_TTL=${newConfig.ttl || '60'}\n`;
			envContent += `CDDS_CHECK_INTERVAL=${newConfig.interval || '5'}\n`;
			envContent += `CDDS_LOGS=${newConfig.logs}\n`;
			envContent += `CDDS_IP_LOGFILE=${newConfig.ipLogFile}\n`;

			await Bun.write(process.cwd() + '/.env', envContent);
			logMessage("Generated .env file via Wizard.");
		}
	};

	if (step === steps.length) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Text color="green" bold>Saved .env successfully!</Text>
				<Newline />
				<Text>Do you want to install this service now?</Text>
				<SelectInput
					items={[
						{ label: 'Yes, go to service installation', value: 'yes' },
						{ label: 'No, return to main menu', value: 'no' }
					]}
					onSelect={(item) => onComplete(item.value === 'yes')}
				/>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Text color="cyan" bold>--- .ENV WIZARD ---</Text>
			<Text>Step {step + 1}/{steps.length}</Text>
			<Box marginTop={1}>
				<Text bold>{currentStep?.label} </Text>
				{currentStep?.type === 'text' ? (
					<TextInput
						value={config[currentStep.key as keyof typeof config]}
						onChange={(value) => setConfig({ ...config, [currentStep.key]: value })}
						onSubmit={handleNext}
					/>
				) : (
					<SelectInput
						items={[{ label: 'True (true)', value: 'true' }, { label: 'False (false)', value: 'false' }]}
						onSelect={(item) => handleNext(item.value)}
					/>
				)}
			</Box>
		</Box>
	);
};

const SystemdManager = ({ onBack }: { onBack: () => void }) => {
	const [status, setStatus] = useState<string>('');
	const [error, setError] = useState<string>('');
	const isRoot = process.getuid ? process.getuid() === 0 : false;

	const validateAndRun = async (action: () => void) => {
		setError('');
		if (!isRoot) {
			setError("Root privileges required! Please run CLI with sudo.");
			return;
		}
		
		try {
			const cfg = await parseEnv();
			if (!cfg) throw new Error("No .env file found. Please run the configuration wizard first.");
			validateConfig(cfg);
			action();
		} catch (err: any) {
			setError(`Validation Error: ${err.message}`);
		}
	};

	const handleInstall = () => {
		validateAndRun(async () => {
			try {
				const projectPath = process.cwd();
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
SyslogIdentifier=cdds

[Install]
WantedBy=multi-user.target
`;
				await Bun.write('/etc/systemd/system/cdds.service', serviceContent);
				execSync('systemctl daemon-reload');
				execSync('systemctl enable cdds');
				execSync('systemctl start cdds');
				setStatus('Systemd Service installed and started successfully!');
				logMessage('Systemd: Installed and started cdds.service');
			} catch (e: any) {
				setError(`Installation failed: ${e.message}`);
				logMessage(`Systemd Error: ${e.message}`);
			}
		});
	};

	const handlePause = () => {
		validateAndRun(() => {
			try {
				execSync('systemctl stop cdds');
				setStatus('Systemd Service stopped (paused).');
				logMessage('Systemd: Stopped cdds.service');
			} catch (e: any) {
				setError(`Failed to stop service: ${e.message}`);
			}
		});
	};

	const handleRemove = () => {
		validateAndRun(() => {
			try {
				try { execSync('systemctl stop cdds'); } catch (e) {}
				try { execSync('systemctl disable cdds'); } catch (e) {}
				const file = Bun.file('/etc/systemd/system/cdds.service');
				if (file.size > 0) execSync('rm /etc/systemd/system/cdds.service');
				execSync('systemctl daemon-reload');
				setStatus('Systemd Service completely removed.');
				logMessage('Systemd: Removed cdds.service');
			} catch (e: any) {
				setError(`Removal failed: ${e.message}`);
			}
		});
	};

	const items = [
		{ label: 'Install / Start Service', value: 'install' },
		{ label: 'Stop (Pause) Service', value: 'pause' },
		{ label: 'Uninstall / Remove Service', value: 'remove' },
		{ label: 'Go Back', value: 'back' }
	];

	return (
		<Box flexDirection="column" marginY={1}>
			<Text color="cyan" bold>--- SYSTEMD MANAGER ---</Text>
			{error && <Text color="red">ERROR: {error}</Text>}
			{status && <Text color="green">SUCCESS: {status}</Text>}
			<Newline />
			<SelectInput
				items={items}
				onSelect={(item) => {
					setStatus('');
					if (item.value === 'install') handleInstall();
					if (item.value === 'pause') handlePause();
					if (item.value === 'remove') handleRemove();
					if (item.value === 'back') onBack();
				}}
			/>
		</Box>
	);
};

const PM2Manager = ({ onBack }: { onBack: () => void }) => {
	const [status, setStatus] = useState<string>('');
	const [error, setError] = useState<string>('');

	const validateAndRun = async (action: () => void) => {
		setError('');
		try {
			const cfg = await parseEnv();
			if (!cfg) throw new Error("No .env file found. Please run the configuration wizard first.");
			validateConfig(cfg);
			action();
		} catch (err: any) {
			setError(`Validation Error: ${err.message}`);
		}
	};

	const handleInstall = () => {
		validateAndRun(async () => {
			try {
				const pm2Content = `module.exports = {
  apps: [
    {
      name: "cloudflare-ddns",
      script: "cdds",
      args: "start",
      interpreter: "none",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "100M",
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
`;
				await Bun.write(process.cwd() + '/pm2.config.js', pm2Content);
				execSync('pm2 start pm2.config.js');
				execSync('pm2 save');
				setStatus('PM2 Service installed and started successfully!');
				logMessage('PM2: Installed and started cloudflare-ddns');
			} catch (e: any) {
				setError(`Installation failed (is pm2 installed globally?): ${e.message}`);
				logMessage(`PM2 Error: ${e.message}`);
			}
		});
	};

	const handlePause = () => {
		validateAndRun(() => {
			try {
				execSync('pm2 stop cloudflare-ddns');
				setStatus('PM2 Service stopped (paused).');
				logMessage('PM2: Stopped cloudflare-ddns');
			} catch (e: any) {
				setError(`Failed to stop service: ${e.message}`);
			}
		});
	};

	const handleRemove = () => {
		validateAndRun(() => {
			try {
				execSync('pm2 delete cloudflare-ddns');
				execSync('pm2 save');
				setStatus('PM2 Service completely removed.');
				logMessage('PM2: Removed cloudflare-ddns');
			} catch (e: any) {
				setError(`Removal failed: ${e.message}`);
			}
		});
	};

	const items = [
		{ label: 'Install / Start Service', value: 'install' },
		{ label: 'Stop (Pause) Service', value: 'pause' },
		{ label: 'Uninstall / Remove Service', value: 'remove' },
		{ label: 'Go Back', value: 'back' }
	];

	return (
		<Box flexDirection="column" marginY={1}>
			<Text color="cyan" bold>--- PM2 MANAGER ---</Text>
			{error && <Text color="red">ERROR: {error}</Text>}
			{status && <Text color="green">SUCCESS: {status}</Text>}
			<Newline />
			<SelectInput
				items={items}
				onSelect={(item) => {
					setStatus('');
					if (item.value === 'install') handleInstall();
					if (item.value === 'pause') handlePause();
					if (item.value === 'remove') handleRemove();
					if (item.value === 'back') onBack();
				}}
			/>
		</Box>
	);
};

const App = () => {
	const { exit } = useApp();
	const [view, setView] = useState('menu');
	const [existingConfig, setExistingConfig] = useState<CloudflareConfig | null>(null);

	useEffect(() => {
		if (view === 'menu') {
			parseEnv().then(cfg => setExistingConfig(cfg));
		}
	}, [view]);

	const handleSelect = (item: any) => {
		if (item.value === 'exit') {
			exit();
		} else {
			setView(item.value);
		}
	};

	const menuItems = [
		{ label: existingConfig ? 'Edit existing .env Configuration' : 'Run .env Configuration Wizard', value: 'env' },
		{ label: 'Manage Systemd Service', value: 'systemd' },
		{ label: 'Manage PM2 Service', value: 'pm2' },
		{ label: 'Exit', value: 'exit' }
	];

	return (
		<Box flexDirection="column" padding={1}>
			<Box borderStyle="single" borderColor="blue" padding={1} marginBottom={1}>
				<Text bold color="blue">CDDS - Service Manager</Text>
			</Box>

			{view === 'menu' && (
				<Box flexDirection="column">
					<Text>Select an action:</Text>
					<SelectInput items={menuItems} onSelect={handleSelect} />
				</Box>
			)}
			{view === 'install_prompt' && (
				<Box flexDirection="column">
					<Text>Which service manager would you like to use?</Text>
					<SelectInput
						items={[
							{ label: 'Systemd (Debian/Ubuntu, requires root)', value: 'systemd' },
							{ label: 'PM2 (Node.js ecosystem)', value: 'pm2' },
							{ label: 'Nevermind, return to main menu', value: 'menu' }
						]}
						onSelect={handleSelect}
					/>
				</Box>
			)}

			{view === 'env' && (
				<EnvWizard initialConfig={existingConfig} onComplete={(installNow) => setView(installNow ? 'install_prompt' : 'menu')} />
			)}
			{view === 'systemd' && <SystemdManager onBack={() => setView('menu')} />}
			{view === 'pm2' && <PM2Manager onBack={() => setView('menu')} />}
		</Box>
	);
};

const args = process.argv.slice(2);
if (args[0] === 'start') {
	startDaemon().catch((err) => {
		console.error(err);
		process.exit(1);
	});
} else {
	render(<App />);
}
