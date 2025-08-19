module.exports = {
  apps: [
    {
      name: "Cloudflare Dynamic DNS Service",
      script: "./main.ts",
      interpreter: "deno",
      interpreterArgs:
        "run --allow-net --allow-read --allow-env --env-file --no-prompt",
      watch: ["main.ts"],
      watch_delay: 1000,
      ignore_watch: ["node_modules", "*.git", "*.log"],
    },
  ],
};
