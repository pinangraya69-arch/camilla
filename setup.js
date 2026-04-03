import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import readline from "readline";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function prompt(query) {
  return new Promise(resolve => rl.question(query, answer => resolve(answer.trim())));
}

async function setup() {
  console.log(`
╔═══════════════════════════════════════════╗
║         Camilla Setup Wizard              ║
╚═══════════════════════════════════════════╝
`);

  console.log("This wizard will create your .env and user-config.json files.\n");

  const env = {};
  const userConfig = {};

  // Wallet
  console.log("1️⃣ Wallet Configuration");
  env.WALLET_PRIVATE_KEY = await prompt("Enter your Solana wallet private key (base58): ");
  if (!env.WALLET_PRIVATE_KEY) {
    console.error("❌ Private key is required.");
    process.exit(1);
  }

  // RPC
  console.log("\n2️⃣ RPC Configuration");
  const rpcDefault = "https://mainnet.helius-rpc.com/?api-key=YOUR_KEY";
  env.RPC_URL = await prompt(`RPC URL [${rpcDefault}]: `) || rpcDefault;
  env.HELIUS_API_KEY = await prompt("Helius API key (for wallet balance lookups): ");

  // LLM
  console.log("\n3️⃣ LLM Configuration (OpenRouter recommended)");
  env.OPENROUTER_API_KEY = await prompt("OpenRouter API key: ");
  env.LLM_MODEL = await prompt("Model [openrouter/anthropic/claude-3-opus]: ") || "openrouter/anthropic/claude-3-opus";

  // Telegram
  console.log("\n4️⃣ Telegram Bot (optional but recommended)");
  const telegramToken = await prompt("Telegram bot token (from @BotFather) [skip to disable]: ");
  if (telegramToken) {
    env.TELEGRAM_BOT_TOKEN = telegramToken;
    console.log("Start the agent and send any message to your bot to auto-register your chat ID.");
  }

  // Twitter
  console.log("\n5️⃣ X (Twitter) Intelligence (optional)");
  const twitterToken = await prompt("Twitter Bearer Token [skip to disable]: ");
  if (twitterToken) {
    env.TWITTER_BEARER_TOKEN = twitterToken;
    userConfig.intelligence = userConfig.intelligence || {};
    userConfig.intelligence.sources = userConfig.intelligence.sources || {};
    userConfig.intelligence.sources.x = { enabled: true };
  }

  // Discord
  console.log("\n6️⃣ Discord Selfbot (advanced, optional)");
  const discordToken = await prompt("Discord user token [skip to disable]: ");
  if (discordToken) {
    env.DISCORD_USER_TOKEN = discordToken;
    const channels = await prompt("Channel IDs (comma-separated): ");
    userConfig.intelligence = userConfig.intelligence || {};
    userConfig.intelligence.sources = userConfig.intelligence.sources || {};
    userConfig.intelligence.sources.discord = {
      enabled: true,
      channelIds: channels.split(",").map(s => s.trim()),
    };
  }

  // Risk settings
  console.log("\n7️⃣ Risk Configuration");
  const maxPos = await prompt("Maximum concurrent positions [3]: ");
  userConfig.maxPositions = maxPos ? parseInt(maxPos) : 3;

  const deployAmt = await prompt("Base deploy amount SOL [0.5]: ");
  userConfig.deployAmountSol = deployAmt ? parseFloat(deployAmt) : 0.5;

  // Mode
  console.log("\n8️⃣ Initial Mode");
  const dryRun = await prompt("Start in DRY_RUN mode? (recommended) [Y/n]: ");
  env.DRY_RUN = dryRun.toLowerCase() !== "n" ? "true" : "false";

  // Write files
  const envPath = path.join(__dirname, ".env");
  const configPath = path.join(__dirname, "user-config.json");

  fs.writeFileSync(envPath, Object.entries(env).map(([k, v]) => `${k}=${v}`).join("\n"));
  fs.writeFileSync(configPath, JSON.stringify(userConfig, null, 2));

  console.log(`
╔═══════════════════════════════════════════╗
║         ✅ Setup complete!               ║
╚═══════════════════════════════════════════╝

Created:
  • .env (API keys, wallet, RPC)
  • user-config.json (risk, intelligence config)

${env.DRY_RUN === "true" ? "Running in DRY_RUN mode — no real transactions will be sent." : "⚠️  LIVE MODE — real funds will be deployed!"}

Next steps:
1. Review the files and adjust thresholds if needed
2. Run: npm start
3. Or run: npm run dev (dry-run)

Enjoy Camilla! 🚀
`);

  rl.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  setup().catch(err => {
    console.error("Setup failed:", err);
    process.exit(1);
  });
}

export { setup };
