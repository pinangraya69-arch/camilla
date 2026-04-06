import "dotenv/config";
import cron from "node-cron";
import readline from "readline";
import { AgentLoop } from "./core/brain.js";
import { Logger } from "./utils/logger.js";
import {
  getMyPositions,
  closePosition,
  getActiveBin,
  deployPosition
} from "./dlmm/position-manager.js";
import { getWalletBalances } from "./dlmm/wallet-ops.js";
import { getTopCandidates } from "./dlmm/pool-analyzer.js";
import { Config } from "./config/index.js";
import { LearningEngine } from "./core/learner.js";
import { IntelligenceCollector } from "./intelligence/collector.js";
import { TelegramBot } from "./utils/telegram.js";
import { generateBriefing } from "./utils/briefing.js";
import { StateManager } from "./core/memory.js";

// Validate critical environment variables on startup
function validateEnv() {
  const required = [];
  if (!process.env.WALLET_PRIVATE_KEY) required.push("WALLET_PRIVATE_KEY");
  if (!process.env.RPC_URL && !process.env.HELIUS_API_KEY) required.push("RPC_URL or HELIUS_API_KEY");
  if (!process.env.LLM_API_KEY && !process.env.OPENROUTER_API_KEY) required.push("LLM_API_KEY");
  
  if (required.length > 0) {
    console.error(`❌ Missing required environment variables: ${required.join(", ")}`);
    console.error("   Please check your .env file and ensure all required variables are set.");
    process.exit(1);
  }
}

validateEnv();

const logger = new Logger("CAMILLA");
const config = Config.load();
const learning = new LearningEngine();
const intelligence = new IntelligenceCollector();
const state = new StateManager();

// Optional API server
let apiServer = null;
let apiModule = null;

async function startAPIServerIfEnabled() {
  if (process.env.API_PORT || process.env.ENABLE_API === "true") {
    try {
      apiModule = await import("./api-server.js");
      apiServer = await apiModule.startAPIServer();
      logger.info(`API server started on port ${process.env.API_PORT || 3001}`);
      return apiServer;
    } catch (err) {
      logger.error("Failed to start API server:", err.message);
      // Continue without API server
      return null;
    }
  }
  return null;
}

// ═══════════════════════════════════════════
//  COORDINATOR — CRON ORCHESTRATION
// ═══════════════════════════════════════════

class Coordinator {
  constructor() {
    this.timers = {
      managementLastRun: null,
      screeningLastRun: null,
      intelligenceLastRun: null,
    };
    this.busy = {
      management: false,
      screening: false,
    };
    this.cronTasks = [];
  }

  start() {
    this.stop();
    logger.info("Starting Camilla autonomous cycles...");

    // Management cycle (every 10 min default)
    const mgmtCron = cron.schedule(
      `*/${config.schedule.managementIntervalMin} * * * *`,
      async () => this.runManagementCycle(),
      { timezone: config.schedule.timezone }
    );

    // Screening cycle (every 30 min default)
    const screenCron = cron.schedule(
      `*/${config.schedule.screeningIntervalMin} * * * *`,
      async () => this.runScreeningCycle(),
      { timezone: config.schedule.timezone }
    );

    // Intelligence refresh (every 15 min default)
    const intelCron = cron.schedule(
      `*/${config.schedule.intelligenceRefreshMin} * * * *`,
      async () => this.runIntelligenceCycle(),
      { timezone: config.schedule.timezone }
    );

    // Morning briefing
    const briefingCron = cron.schedule(
      `0 ${config.schedule.briefingHour} * * *`,
      async () => this.sendBriefing(),
      { timezone: config.schedule.timezone }
    );

    this.cronTasks = [mgmtCron, screenCron, intelCron, briefingCron];
    logger.info(`Cycles started | Mgmt: ${config.schedule.managementIntervalMin}m | Screen: ${config.schedule.screeningIntervalMin}m | Intel: ${config.schedule.intelligenceRefreshMin}m`);
  }

  stop() {
    for (const task of this.cronTasks) task.stop();
    this.cronTasks = [];
  }

  async runManagementCycle() {
    if (this.busy.management) {
      logger.debug("Management skipped — already running");
      return;
    }
    this.busy.management = true;
    this.timers.managementLastRun = Date.now();

    try {
      logger.info("=== Management Cycle Start ===");
      const positions = await getMyPositions({ force: true });
      const report = await this.managePositions(positions.positions);
      await this.notifyTelegram(`🔄 Management Cycle\n\n${this.stripThink(report)}`);
      await this.checkOutOfRangeAlerts(positions.positions);
    } catch (err) {
      logger.error("Management cycle failed:", err);
    } finally {
      this.busy.management = false;
    }
  }

  async managePositions(positions) {
    if (positions.length === 0) {
      await this.runScreeningCycle();
      return "No open positions — triggered screening.";
    }

    // Snapshot + load memory
    const positionData = positions.map(p => ({
      ...p,
      recall: state.recallForPool(p.pool),
      instruction: state.getPositionInstruction(p.position)
    }));

    // Deterministic rule checks (no LLM)
    const actionMap = new Map();
    for (const p of positionData) {
      const exit = learning.checkExitConditions(p, config.management);
      if (exit) {
        actionMap.set(p.position, { action: "CLOSE", reason: exit.reason });
        continue;
      }

      if (p.instruction) {
        actionMap.set(p.position, { action: "INSTRUCTION" });
        continue;
      }

      // Rule: claim fees
      if ((p.unclaimed_fees_usd ?? 0) >= config.management.minClaimAmount) {
        actionMap.set(p.position, { action: "CLAIM" });
        continue;
      }

      actionMap.set(p.position, { action: "STAY" });
    }

    // Build report
    const reportLines = positionData.map(p => {
      const act = actionMap.get(p.position);
      const status = act.action === "STAY" ? "HOLD" : act.action;
      const reason = act.reason ? ` (${act.reason})` : "";
      return `**${p.pair}** | Val: $${p.total_value_usd} | PnL: ${p.pnl_pct}% | ${status}${reason}`;
    });

    const needsAction = [...actionMap.values()].filter(a => a.action !== "STAY");
    const summary = needsAction.length > 0
      ? needsAction.map(a => `${a.action}${a.reason ? ` (${a.reason})` : ""}`).join(", ")
      : "no action";

    let report = reportLines.join("\n") +
      `\n\nSummary: ${positions.length} positions | ${summary}\n`;

    // Call LLM only if action needed
    const actionPositions = positionData.filter(p => {
      const a = actionMap.get(p.position);
      return a.action !== "STAY";
    });

    if (actionPositions.length > 0) {
      logger.info(`Management: ${actionPositions.length} action(s) needed — invoking LLM`);
      const actionBlocks = actionPositions.map(p => {
        const act = actionMap.get(p.position);
        return [
          `POSITION: ${p.pair} (${p.position})`,
          `  action: ${act.action}${act.reason ? ` — ${act.reason}` : ""}`,
          `  pnl: ${p.pnl_pct}% | fees: $${p.unclaimed_fees_usd} | oor: ${p.minutes_out_of_range}m`
        ].join("\n");
      }).join("\n\n");

      const { content } = await AgentLoop.execute(
        `MANAGEMENT ACTION — ${actionPositions.length} position(s)\n\n${actionBlocks}\n\nExecute required actions.`,
        "MANAGER",
        config.llm.managementModel
      );
      report += `\n\n${content}`;
    }

    return report;
  }

  async runScreeningCycle() {
    if (this.busy.screening) {
      logger.debug("Screening skipped — already running");
      return null;
    }
    this.busy.screening = true;
    this.timers.screeningLastRun = Date.now();

    try {
      logger.info("=== Screening Cycle Start ===");
      const pre = await Promise.all([
        getMyPositions({ force: true }),
        getWalletBalances()
      ]);
      const positions = pre[0];
      const balance = pre[1];

      if (positions.total_positions >= config.risk.maxPositions) {
        return "Max positions reached — skipping screening.";
      }

      const minRequired = config.management.deployAmountSol + config.management.gasReserve;
      if (balance.sol < minRequired) {
        return `Insufficient SOL ($${balance.sol} < ${minRequired} needed) — skipping.`;
      }

      const deployAmount = Config.computeDeployAmount(balance.sol);
      const candidates = await getTopCandidates({ limit: 10 });
      const enriched = await this.enrichCandidates(candidates);

      // Get latest intelligence signals
      const intel = await intelligence.getCurrentSignals();

      const { content } = await AgentLoop.execute(
        this.buildScreeningPrompt(deployAmount, enriched, intel, balance),
        "SCREENER",
        config.llm.screeningModel
      );

      // Parse decision and potentially deploy
      const decision = this.parseScreeningDecision(content);
      if (decision.deployed) {
        await learning.recordDeploy(decision);
      }

      return content;
    } finally {
      this.busy.screening = false;
    }
  }

  async enrichCandidates(candidates) {
    const enriched = [];
    for (const pool of candidates) {
      const [sw, narrative, tokenInfo, activeBin] = await Promise.allSettled([
        intelligence.checkSmartWallets(pool.pool),
        intelligence.getTokenNarrative(pool.base?.mint),
        intelligence.getTokenInfo(pool.base?.mint),
        getActiveBin({ pool_address: pool.pool })
      ]);

      enriched.push({
        pool,
        sw: sw.status === "fulfilled" ? sw.value : null,
        narrative: narrative.status === "fulfilled" ? narrative.value : null,
        tokenInfo: tokenInfo.status === "fulfilled" ? tokenInfo.value : null,
        activeBin: activeBin.status === "fulfilled" ? activeBin.value : null,
        memory: state.recallForPool(pool.pool)
      });

      await new Promise(r => setTimeout(r, 150)); // rate limit
    }
    return enriched;
  }

  buildScreeningPrompt(deployAmount, candidates, intel, balance) {
    const strategy = config.getActiveStrategy();
    const strategyBlock = strategy
      ? `ACTIVE STRATEGY: ${strategy.name}\nLP: ${strategy.lp_strategy} | range: ${strategy.range?.bins_above ?? 0} above | deposit: ${strategy.entry?.single_side === "sol" ? "SOL only" : "dual-sided"}`
      : "No active strategy — use default bid_ask with bins_above=0.";

    const intelBlock = [
      `INTELLIGENCE SIGNALS (${intel.sources.length} sources):`,
      ...intel.signalSummaries,
      `Signal Strength: ${intel.confidenceScore.toFixed(2)}`
    ].join("\n");

    const candidateLines = candidates.map(c => {
      const sw = c.sw?.in_pool?.length || 0;
      const sig = c.tokenInfo?.signals || {};
      return `- ${c.pool.name}: fee_tvl=${c.pool.fee_active_tvl_ratio}%, vol=$${c.pool.volume_window}, organic=${c.pool.organic_score}, smart_wallets=${sw}, narrative="${c.narrative?.slice(0, 100)}"`;
    }).join("\n");

    return `
SCREENING CYCLE

${strategyBlock}

Wallet: ${balance.sol.toFixed(3)} SOL | Deploy: ${deployAmount} SOL
Positions: ${config.risk.maxPositions - (await getMyPositions()).total_positions} slots available

${intelBlock}

CANDIDATES (${candidates.length}):
${candidateLines}

STEPS:
1. Consider intelligence signals (X sentiment, smart money, KOL) as BOOST, not sole criteria.
2. Pick best candidate based on metrics + signals + pool memory.
3. Call get_active_bin if needed, then deploy_position.
4. Report in format:
   Decision: DEPLOYED | NO DEPLOY
   Pool: <name> (<address>)
   Strategy: <bid_ask|spot> | bins_below=X | bins_above=Y
   Intelligence: <how signals influenced decision>
   Analysis: <2-3 sentences>
   `;
  }

  parseScreeningDecision(content) {
    const deployed = content.includes("DEPLOYED");
    const poolMatch = content.match(/Pool:\s*(.+)\s*\((.+)\)/);
    return {
      deployed,
      poolName: poolMatch?.[1] || null,
      poolAddress: poolMatch?.[2] || null,
      raw: content
    };
  }

  async runIntelligenceCycle() {
    this.timers.intelligenceLastRun = Date.now();
    logger.debug("Intelligence refresh cycle");
    await intelligence.refreshAll();
  }

  async sendBriefing() {
    try {
      const briefing = await generateBriefing();
      await this.notifyTelegram(briefing);
    } catch (err) {
      logger.error("Briefing failed:", err);
    }
  }

  async checkOutOfRangeAlerts(positions) {
    for (const p of positions) {
      if (!p.in_range && p.minutes_out_of_range >= config.management.outOfRangeWaitMinutes) {
        await this.notifyTelegram(`⚠️ ${p.pair} OOR for ${p.minutes_out_of_range}m — consider closing.`);
      }
    }
  }

  stripThink(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  }

  async notifyTelegram(msg) {
    if (config.telegram.enabled) {
      await TelegramBot.sendMessage(msg);
    }
  }
}

// ═══════════════════════════════════════════
//  MAIN ENTRY
// ═══════════════════════════════════════════

const coordinator = new Coordinator();

async function main() {
  logger.info("Camilla v0.1.0 starting...");
  logger.info(`Mode: ${process.env.DRY_RUN === "true" ? "DRY RUN" : "LIVE"}`);

  // Initialize DB
  await state.connect();
  await learning.connect();

  // Start API server if enabled (for frontend dashboard)
  await startAPIServerIfEnabled();

  // Load state
  const positions = await getMyPositions();
  const balance = await getWalletBalances();
  logger.info(`Wallet: ${balance.sol} SOL | Positions: ${positions.total_positions}`);

  // Start cycles
  coordinator.start();

  // REPL if TTY
  if (process.stdin.isTTY) {
    startREPL();
  }
}

// Graceful shutdown
async function shutdown(signal) {
  logger.info(`Received ${signal} — shutting down gracefully...`);
  
  // Stop coordinator cycles
  coordinator.stop();
  
  // Flush pending file writes
  state.flushAll();
  
  // Close database connection
  learning.disconnect();
  
  // Stop API server if running
  if (apiServer) {
    await new Promise(resolve => {
      apiServer.close(() => {
        logger.info("API server closed");
        resolve();
      });
    });
  }
  
  logger.info("Shutdown complete");
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function startREPL() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: buildPrompt()
  });

  setInterval(() => {
    rl.setPrompt(buildPrompt());
    rl.prompt(true);
  }, 10000);

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) return rl.prompt();

    try {
      const response = await AgentLoop.execute(input, "GENERAL", config.llm.generalModel);
      console.log(`\n${response}\n`);
    } catch (err) {
      console.error(`Error: ${err.message}\n`);
    }
    rl.prompt();
  });

  rl.on("close", () => {
    coordinator.stop();
    process.exit(0);
  });

  rl.prompt();
}

function buildPrompt() {
  const mgmt = formatCountdown(
    nextRunIn(coordinator.timers.managementLastRun, config.schedule.managementIntervalMin)
  );
  const screen = formatCountdown(
    nextRunIn(coordinator.timers.screeningLastRun, config.schedule.screeningIntervalMin)
  );
  const intel = formatCountdown(
    nextRunIn(coordinator.timers.intelligenceLastRun, config.schedule.intelligenceRefreshMin)
  );
  return `[manage: ${mgmt} | screen: ${screen} | intel: ${intel}]\n> `;
}

function nextRunIn(lastRun, intervalMin) {
  if (!lastRun) return intervalMin * 60;
  const elapsed = (Date.now() - lastRun) / 1000;
  return Math.max(0, intervalMin * 60 - elapsed);
}

function formatCountdown(seconds) {
  if (seconds <= 0) return "now";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// Start
if (require.main === module) {
  main().catch(err => {
    logger.error("Fatal error:", err);
    process.exit(1);
  });
}

export { Coordinator, main };
