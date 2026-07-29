module.exports = {
  apps: [
    {
      name: "Cloudflare Dynamic DNS Service",
      script: "./main.ts",
      interpreter: "bun",
      interpreterArgs: "run",
      watch: ["main.ts"],
      watch_delay: 1000,
      ignore_watch: ["node_modules", "*.git", "*.log"],
    },
  ],
};
