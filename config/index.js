import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const USER_CONFIG_PATH = path.join(__dirname, "user-config.json");

class Config {
  static load() {
    const userConfig = fs.existsSync(USER_CONFIG_PATH)
      ? JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"))
      : {};

    // Merge with defaults
    return Object.freeze({
      risk: {
        maxPositions: userConfig.maxPositions ?? 3,
        maxDeployAmount: userConfig.maxDeployAmount ?? 50,
      },

      screening: {
        minFeeActiveTvlRatio: userConfig.minFeeActiveTvlRatio ?? 0.05,
        minTvl: userConfig.minTvl ?? 10000,
        maxTvl: userConfig.maxTvl ?? 150000,
        minVolume: userConfig.minVolume ?? 500,
        minOrganic: userConfig.minOrganic ?? 60,
        minHolders: userConfig.minHolders ?? 500,
        minMcap: userConfig.minMcap ?? 150000,
        maxMcap: userConfig.maxMcap ?? 10000000,
        minBinStep: userConfig.minBinStep ?? 80,
        maxBinStep: userConfig.maxBinStep ?? 125,
        blockedLaunchpads: userConfig.blockedLaunchpads ?? ["pump.fun", "letsbonk.fun"],
        maxBotHoldersPct: userConfig.maxBotHoldersPct ?? 30,
        maxTop10Pct: userConfig.maxTop10Pct ?? 60,
      },

      management: {
        minClaimAmount: userConfig.minClaimAmount ?? 5,
        outOfRangeBinsToClose: userConfig.outOfRangeBinsToClose ?? 10,
        outOfRangeWaitMinutes: userConfig.outOfRangeWaitMinutes ?? 30,
        stopLossPct: userConfig.stopLossPct ?? -50,
        takeProfitFeePct: userConfig.takeProfitFeePct ?? 5,
        minFeePerTvl24h: userConfig.minFeePerTvl24h ?? 7,
        minAgeBeforeYieldCheck: userConfig.minAgeBeforeYieldCheck ?? 60,
        minSolToOpen: userConfig.minSolToOpen ?? 0.55,
        deployAmountSol: userConfig.deployAmountSol ?? 0.5,
        gasReserve: userConfig.gasReserve ?? 0.2,
        positionSizePct: userConfig.positionSizePct ?? 0.35,
        trailingTakeProfit: userConfig.trailingTakeProfit ?? true,
        trailingTriggerPct: userConfig.trailingTriggerPct ?? 3,
        trailingDropPct: userConfig.trailingDropPct ?? 1.5,
        solMode: userConfig.solMode ?? false,
      },

      learning: {
        minPositionsToEvolve: userConfig.learning?.minPositionsToEvolve ?? 10,
        evolutionStrength: userConfig.learning?.evolutionStrength ?? 0.1,
        memoryRetentionDays: userConfig.learning?.memoryRetentionDays ?? 90,
        reinforcement: {
          winReward: userConfig.learning?.reinforcement?.winReward ?? 1.0,
          lossPenalty: userConfig.learning?.reinforcement?.lossPenalty ?? -1.5,
          drawReward: userConfig.learning?.reinforcement?.drawReward ?? 0.2,
        },
      },

      intelligence: {
        sources: {
          x: {
            enabled: userConfig.intelligence?.sources?.x?.enabled ?? true,
            bearerToken: process.env.TWITTER_BEARER_TOKEN,
            trackedAccounts: userConfig.intelligence?.sources?.x?.trackedAccounts ?? [],
            minMentions: userConfig.intelligence?.sources?.x?.minMentions ?? 3,
          },
          discord: {
            enabled: userConfig.intelligence?.sources?.discord?.enabled ?? true,
            userToken: process.env.DISCORD_USER_TOKEN,
            channelIds: userConfig.intelligence?.sources?.discord?.channelIds ?? [],
          },
          smartMoney: {
            enabled: userConfig.intelligence?.sources?.smartMoney?.enabled ?? true,
            minProfitability: userConfig.intelligence?.sources?.smartMoney?.minProfitability ?? "5%",
            minHoldDuration: userConfig.intelligence?.sources?.smartMoney?.minHoldDuration ?? "1h",
            trackTopN: userConfig.intelligence?.sources?.smartMoney?.trackTopN ?? 20,
          },
          kol: {
            enabled: userConfig.intelligence?.sources?.kol?.enabled ?? true,
            trackedWallets: userConfig.intelligence?.sources?.kol?.trackedWallets ?? [],
          },
        },
        signalFusion: {
          requireAtLeast: userConfig.intelligence?.signalFusion?.requireAtLeast ?? 2,
          confidenceThreshold: userConfig.intelligence?.signalFusion?.confidenceThreshold ?? 0.7,
          decayRate: userConfig.intelligence?.signalFusion?.decayRate ?? 0.95,
        },
      },

      schedule: {
        managementIntervalMin: userConfig.schedule?.managementIntervalMin ?? 10,
        screeningIntervalMin: userConfig.schedule?.screeningIntervalMin ?? 30,
        intelligenceRefreshMin: userConfig.schedule?.intelligenceRefreshMin ?? 15,
        briefingHour: userConfig.schedule?.briefingHour ?? 1, // UTC hour
        timezone: userConfig.schedule?.timezone ?? "UTC",
      },

      llm: {
        temperature: userConfig.llm?.temperature ?? 0.3,
        maxTokens: userConfig.llm?.maxTokens ?? 4096,
        maxSteps: userConfig.llm?.maxSteps ?? 20,
        managementModel: userConfig.llm?.managementModel ?? process.env.LLM_MODEL || "openrouter/anthropic/claude-3-opus",
        screeningModel: userConfig.llm?.screeningModel ?? process.env.LLM_MODEL || "openrouter/anthropic/claude-3-opus",
        generalModel: userConfig.llm?.generalModel ?? process.env.LLM_MODEL || "openrouter/anthropic/claude-3-opus",
      },

      telegram: {
        enabled: !!process.env.TELEGRAM_BOT_TOKEN,
      },

      tokens: {
        SOL: "So11111111111111111111111111111111111111112",
        USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      },
    });
  }

  static computeDeployAmount(walletSol) {
    const cfg = this.load();
    const reserve = cfg.management.gasReserve;
    const pct = cfg.management.positionSizePct;
    const floor = cfg.management.deployAmountSol;
    const ceil = cfg.risk.maxDeployAmount;
    const deployable = Math.max(0, walletSol - reserve);
    const dynamic = deployable * pct;
    const result = Math.min(ceil, Math.max(floor, dynamic));
    return parseFloat(result.toFixed(2));
  }

  static getActiveStrategy() {
    const db = this.loadStrategyDB();
    return db.active && db.strategies[db.active] ? db.strategies[db.active] : null;
  }

  static loadStrategyDB() {
    const path = path.join(__dirname, "strategy-library.json");
    if (!fs.existsSync(path)) return { active: null, strategies: {} };
    return JSON.parse(fs.readFileSync(path, "utf8"));
  }

  static evolveThresholds(changes) {
    const cfg = this.load();
    const maxChange = cfg.learning.evolutionStrength;
    const clamped = {};

    for (const [key, newValue] of Object.entries(changes)) {
      const old = this.getNested(cfg, key);
      if (old) {
        const changePct = Math.abs(newValue - old) / old;
        if (changePct > maxChange) {
          clamped[key] = old * (newValue > old ? (1 + maxChange) : (1 - maxChange));
        } else {
          clamped[key] = newValue;
        }
      }
    }

    // Apply to user-config.json
    const userConfig = JSON.parse(fs.readFileSync(USER_CONFIG_PATH, "utf8"));
    for (const [key, value] of Object.entries(clamped)) {
      this.setNested(userConfig, key, value);
    }
    fs.writeFileSync(USER_CONFIG_PATH, JSON.stringify(userConfig, null, 2));

    return clamped;
  }

  static getNested(obj, path) {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }

  static setNested(obj, path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => {
      if (!o[k]) o[k] = {};
      return o[k];
    }, obj);
    target[last] = value;
  }
}

export { Config };
