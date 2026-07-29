#!/usr/bin/env bun
import React, { useState } from 'react';
import { render, Box, Text, useApp, Newline } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import process from 'process';
import { startDaemon } from './main.ts';

// Menu Options
const items = [
	{ label: 'Run .env Configuration Wizard', value: 'env' },
	{ label: 'Generate Systemd Service File', value: 'systemd' },
	{ label: 'Generate PM2 Configuration File', value: 'pm2' },
	{ label: 'Exit', value: 'exit' }
];

const EnvWizard = ({ onComplete }: { onComplete: () => void }) => {
	const [step, setStep] = useState(0);
	const [config, setConfig] = useState({
		apiKey: '',
		email: '',
		targets: '',
		zoneId: '',
		ttl: '60',
		interval: '5',
		logs: 'true',
		ipLogFile: 'true'
	});

	const steps = [
		{ key: 'apiKey', label: 'Cloudflare API Key / Token:' },
		{ key: 'email', label: 'Cloudflare Email (Leave empty if using Token):' },
		{ key: 'targets', label: 'Targets (comma separated, e.g. sub.domain.com):' },
		{ key: 'zoneId', label: 'Zone ID (Optional, leave empty for auto-discover):' },
		{ key: 'ttl', label: 'TTL in seconds (default 60):' },
		{ key: 'interval', label: 'Check interval in minutes (default 5):' },
		{ key: 'logs', label: 'Enable console logs? (true/false):' },
		{ key: 'ipLogFile', label: 'Enable IP log file? (true/false, or file path):' }
	];

	const currentStep = steps[step];

	const handleSubmit = async (value: string) => {
		if (!currentStep) return;
		const key = currentStep.key as keyof typeof config;
		const newConfig = { ...config, [key]: value };
		setConfig(newConfig);

		if (step < steps.length - 1) {
			setStep(step + 1);
		} else {
			// Finished
			let envContent = `CDDS_API_KEY=${newConfig.apiKey}\n`;
			if (newConfig.email) envContent += `CDDS_EMAIL=${newConfig.email}\n`;
			envContent += `CDDS_TARGETS=${newConfig.targets}\n`;
			if (newConfig.zoneId) envContent += `CDDS_ZONE_ID=${newConfig.zoneId}\n`;
			envContent += `CDDS_TTL=${newConfig.ttl || '60'}\n`;
			envContent += `CDDS_CHECK_INTERVAL=${newConfig.interval || '5'}\n`;
			envContent += `CDDS_LOGS=${newConfig.logs || 'true'}\n`;
			envContent += `CDDS_IP_LOGFILE=${newConfig.ipLogFile || 'true'}\n`;

			await Bun.write(process.cwd() + '/.env', envContent);
			onComplete();
		}
	};

	if (!currentStep) return <Text color="green">Saved .env successfully!</Text>;

	return (
		<Box flexDirection="column" marginY={1}>
			<Text color="cyan" bold>--- .ENV WIZARD ---</Text>
			<Text>Step {step + 1}/{steps.length}</Text>
			<Box marginTop={1}>
				<Text bold>{currentStep.label} </Text>
				<TextInput
					value={config[currentStep.key as keyof typeof config]}
					onChange={(value) => setConfig({ ...config, [currentStep.key]: value })}
					onSubmit={handleSubmit}
				/>
			</Box>
		</Box>
	);
};

const SystemdWizard = ({ onComplete }: { onComplete: () => void }) => {
	const [done, setDone] = useState(false);

	React.useEffect(() => {
		const generate = async () => {
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
			await Bun.write(projectPath + '/cdds.service', serviceContent);
			setDone(true);
		};
		generate();
	}, []);

	if (!done) return <Text>Generating cdds.service...</Text>;

	return (
		<Box flexDirection="column" marginY={1} borderStyle="round" borderColor="green" padding={1}>
			<Text color="green" bold>Systemd Service Generated: cdds.service</Text>
			<Newline />
			<Text>To install and start the service on Debian/Ubuntu, run:</Text>
			<Text color="cyan">sudo cp cdds.service /etc/systemd/system/</Text>
			<Text color="cyan">sudo systemctl daemon-reload</Text>
			<Text color="cyan">sudo systemctl enable --now cdds</Text>
			<Newline />
			<Text color="gray">(Press Enter to return to menu)</Text>
			<TextInput value="" onChange={() => {}} onSubmit={onComplete} />
		</Box>
	);
};

const PM2Wizard = ({ onComplete }: { onComplete: () => void }) => {
	const [done, setDone] = useState(false);

	React.useEffect(() => {
		const generate = async () => {
			const projectPath = process.cwd();
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
			await Bun.write(projectPath + '/pm2.config.js', pm2Content);
			setDone(true);
		};
		generate();
	}, []);

	if (!done) return <Text>Generating pm2.config.js...</Text>;

	return (
		<Box flexDirection="column" marginY={1} borderStyle="round" borderColor="green" padding={1}>
			<Text color="green" bold>PM2 Configuration Generated: pm2.config.js</Text>
			<Newline />
			<Text>To start the service using PM2, run:</Text>
			<Text color="cyan">pm2 start pm2.config.js</Text>
			<Newline />
			<Text color="gray">(Press Enter to return to menu)</Text>
			<TextInput value="" onChange={() => {}} onSubmit={onComplete} />
		</Box>
	);
};

const App = () => {
	const { exit } = useApp();
	const [view, setView] = useState('menu');

	const handleSelect = (item: any) => {
		if (item.value === 'exit') {
			exit();
		} else {
			setView(item.value);
		}
	};

	return (
		<Box flexDirection="column" padding={1}>
			<Box borderStyle="single" borderColor="blue" padding={1} marginBottom={1}>
				<Text bold color="blue">CDDS - Cloudflare Dynamic DNS Service</Text>
			</Box>

			{view === 'menu' && (
				<Box flexDirection="column">
					<Text>Select an action:</Text>
					<SelectInput items={items} onSelect={handleSelect} />
				</Box>
			)}

			{view === 'env' && <EnvWizard onComplete={() => setView('menu')} />}
			{view === 'systemd' && <SystemdWizard onComplete={() => setView('menu')} />}
			{view === 'pm2' && <PM2Wizard onComplete={() => setView('menu')} />}
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
