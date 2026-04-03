import OpenAI from "openai";
import { tools } from "../tools/definitions.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("BRAIN");

/**
 * Core ReAct agent with enhanced context management.
 * Supports role-based tool selection and strategy injection.
 */
export class AgentLoop {
  static async execute(goal, role = "GENERAL", model = null, maxSteps = 20, sessionHistory = []) {
    const client = new OpenAI({
      baseURL: process.env.LLM_BASE_URL || "https://openrouter.ai/api/v1",
      apiKey: process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY,
      timeout: 5 * 60 * 1000,
    });

    const systemPrompt = await this.buildSystemPrompt(role);
    const messages = [
      { role: "system", content: systemPrompt },
      ...sessionHistory.slice(-10), // max 10 history items
      { role: "user", content: goal },
    ];

    const ONCE_PER_SESSION = new Set(["deploy_position", "swap_token", "close_position"]);
    const firedOnce = new Set();
    const toolChoice = this.requiresTool(goal) ? "required" : "auto";

    for (let step = 0; step < maxSteps; step++) {
      logger.debug(`Step ${step + 1}/${maxSteps}`);

      try {
        const response = await client.chat.completions.create({
          model: model || this.defaultModelForRole(role),
          messages,
          tools: this.getToolsForRole(role),
          tool_choice: toolChoice,
          temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.3,
          max_tokens: 4096,
        });

        const msg = response.choices[0]?.message;
        if (!msg) throw new Error("Empty response from LLM");

        // Handle malformed tool calls
        if (msg.tool_calls) {
          for (const tc of msg.tool_calls) {
            if (tc.function?.arguments) {
              try {
                JSON.parse(tc.function.arguments);
              } catch {
                tc.function.arguments = "{}";
                logger.warn(`Cleared malformed JSON for ${tc.function.name}`);
              }
            }
          }
        }

        messages.push(msg);

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
          if (!msg.content) {
            messages.pop();
            continue; // retry
          }
          return msg.content;
        }

        // Execute tools
        const toolResults = await Promise.all(msg.tool_calls.map(async (tc) => {
          const name = tc.function.name;
          const args = JSON.parse(tc.function.arguments || "{}");

          // Block duplicate once-per-session tools
          if (ONCE_PER_SESSION.has(name) && firedOnce.has(name)) {
            return {
              role: "tool",
              tool_call_id: tc.id,
              content: JSON.stringify({ blocked: true, reason: `${name} already executed this session` }),
            };
          }

          const result = await this.executeTool(name, args);

          if (ONCE_PER_SESSION.has(name) && result.success) {
            firedOnce.add(name);
          }

          return {
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(result),
          };
        }));

        messages.push(...toolResults);

      } catch (err) {
        logger.error(`Agent error at step ${step}:`, err.message);
        if (err.status === 429) {
          await this.sleep(30000);
          continue;
        }
        throw err;
      }
    }

    return "Max steps reached — check logs for partial progress.";
  }

  static async executeTool(name, args) {
    // Dynamic tool imports
    try {
      switch (name) {
        case "get_active_bin":
          return await (await import("../dlmm/position-manager.js")).getActiveBin(args);
        case "deploy_position":
          return await (await import("../dlmm/position-manager.js")).deployPosition(args);
        case "get_my_positions":
          return await (await import("../dlmm/position-manager.js")).getMyPositions(args);
        case "close_position":
          return await (await import("../dlmm/position-manager.js")).closePosition(args);
        case "get_top_candidates":
          return await (await import("../dlmm/pool-analyzer.js")).getTopCandidates(args);
        case "get_wallet_balance":
          return await (await import("../dlmm/wallet-ops.js")).getWalletBalances(args);
        case "get_token_info":
          return await (await import("../intelligence/social.js")).getTokenInfo(args);
        case "check_smart_wallets":
          return await (await import("../intelligence/smart-money.js")).checkSmartWallets(args);
        case "x_sentiment":
          return await (await import("../intelligence/x-signals.js")).analyzeToken(args);
        case "discord_signals":
          return await (await import("../intelligence/discord-scraper.js")).getSignals(args);
        case "get_episodes":
          return await (await import("./memory.js")).getRecentEpisodes(args);
        case "add_lesson":
          return await (await import("./learner.js")).addLesson(args);
        case "evolve_thresholds":
          return await (await import("./learner.js")).evolveThresholds();
        default:
          return { error: `Unknown tool: ${name}` };
      }
    } catch (err) {
      return { error: err.message, stack: err.stack };
    }
  }

  static async buildSystemPrompt(role) {
    const { config } = await import("../config/index.js");
    const learning = await (await import("./learner.js")).getSummary();

    const base = `You are Camilla, an autonomous LP agent on Meteora/Solana.
Role: ${role}

CORE PRINCIPLES:
1. PATIENCE — LPing is about fee accumulation over time
2. GAS EFFICIENCY — avoid needless transactions
3. DATA-DRIVEN — use all available tools before deciding
4. CONTINUOUS LEARNING — record outcomes, derive lessons

CONFIG:
${JSON.stringify(config, null, 2)}

LEARNING SUMMARY:
${learning}

MEMORY ACCESS:
- Use get_episodes to review past trades
- Use add_lesson to save new insights
- Use evolve_thresholds to adapt thresholds (after 10+ positions)

`;

    if (role === "MANAGER") {
      return base + `MANAGER DUTIES:
- Apply deterministic exit rules first
- Claim fees when threshold met
- Close positions only for clear reasons
- Check PnL API for real-time metrics
- After closing, call learning.recordOutcome
`;
    }

    if (role === "SCREENER") {
      return base + `SCREENER DUTIES:
- Use get_top_candidates (not discover_pools)
- Consider intelligence signals as BOOST not sole criteria
- Check pool memory before deploying
- Choose strategy based on active strategy template
- Always get_active_bin before deploy_position
- bins_below formula: round(35 + (volatility / 5) * 55) clamped [35,90]
`;
    }

    return base;
  }

  static defaultModelForRole(role) {
    switch (role) {
      case "MANAGER": return process.env.LLL_MANAGEMENT_MODEL || "openrouter/anthropic/claude-3-haiku";
      case "SCREENER": return process.env.LLL_SCREENING_MODEL || "openrouter/anthropic/claude-3-sonnet";
      default: return process.env.LLL_GENERAL_MODEL || "openrouter/anthropic/claude-3-haiku";
    }
  }

  static getToolsForRole(role) {
    const allTools = tools;

    const roleFilters = {
      MANAGER: new Set(["get_my_positions", "close_position", "claim_fees", "get_position_pnl", "get_wallet_balance", "set_position_note"]),
      SCREENER: new Set(["get_top_candidates", "deploy_position", "get_active_bin", "get_token_info", "check_smart_wallets", "get_pool_memory", "get_wallet_balance"]),
      GENERAL: allTools.map(t => t.function.name),
    };

    if (!roleFilters[role]) return tools;

    return tools.filter(t => roleFilters[role].has(t.function.name));
  }

  static requiresTool(goal) {
    const ACTION_INTENTS = /\b(deploy|open|add liquidity|lp into|close|exit|withdraw|claim|swap|check|get|show|analyze)\b/i;
    return ACTION_INTENTS.test(goal);
  }

  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export { AgentLoop };
