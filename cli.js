#!/usr/bin/env node

import { Config } from "./config/index.js";
import { LearningEngine } from "./core/learner.js";
import { Coordinator } from "./index.js";

const commands = {
  status: async () => {
    const [wallet, positions] = await Promise.all([
      (await import("./dlmm/wallet-ops.js")).getWalletBalances(),
      (await import("./dlmm/position-manager.js")).getMyPositions(),
    ]);
    console.log(`Wallet: ${wallet.sol} SOL ($${wallet.sol_usd})`);
    console.log(`Positions: ${positions.total_positions}`);
    positions.positions.forEach(p => {
      const status = p.in_range ? "in-range" : "OOR";
      console.log(`  ${p.pair} | $${p.total_value_usd} | PnL: ${p.pnl_pct}% | ${status}`);
    });
  },

  candidates: async () => {
    const { candidates } = await (await import("./dlmm/pool-analyzer.js")).getTopCandidates({ limit: 10 });
    candidates.forEach((c, i) => {
      console.log(`${i+1}. ${c.pool.name} — fee_tvl: ${c.pool.fee_active_tvl_ratio}%, vol: $${c.pool.volume_window}, score: ${c.score.toFixed(1)}`);
    });
  },

  screen: async () => {
    const coordinator = new Coordinator();
    await coordinator.runScreeningCycle();
  },

  manage: async () => {
    const coordinator = new Coordinator();
    await coordinator.runManagementCycle();
  },

  episodes: async (args) => {
    const limit = args[0] ? parseInt(args[0]) : 20;
    const learning = new LearningEngine();
    const episodes = learning.getRecentEpisodes(limit);
    episodes.forEach((ep, i) => {
      console.log(`${i+1}. ${ep.decision.pool_name?.slice(0, 20)} — PnL: ${ep.outcome.pnl_pct}% (${ep.outcome.close_reason})`);
    });
  },

  lessons: async () => {
    const learning = new LearningEngine();
    const lessons = learning.getLessonsForPrompt(0.5, 15);
    lessons.forEach((l, i) => {
      console.log(`${i+1}. [${(l.confidence*100).toFixed(0)}%] ${l.rule}`);
    });
  },

  evolve: async () => {
    const learning = new LearningEngine();
    const result = await learning.evolveThresholds();
    console.log(result);
  },

  config: async (subcmd, key, value) => {
    const config = Config.load();
    if (!key) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }
    if (value) {
      Config.evolveThresholds({ [key]: parseFloat(value) });
      console.log(`Set ${key} = ${value}`);
    } else {
      console.log(`${key}: ${Config.getNested(config, key)}`);
    }
  },

  intelligence: async (source) => {
    const intel = new (await import("./intelligence/collector.js")).IntelligenceCollector();
    await intel.refreshAll();
    const current = await intel.getCurrentSignals();
    console.log(`Signals: ${current.signals.length} total`);
    current.tokenScores.forEach(ts => {
      console.log(`  ${ts.mint.slice(0, 8)}: score=${ts.aggregateScore.toFixed(2)} sources=${ts.sourceCount}`);
    });
  },

  help: () => {
    console.log(`
Camilla CLI

Commands:
  status                    Show wallet + positions
  candidates                List top pool candidates
  screen                    Run screening cycle once
  manage                    Run management cycle once
  episodes [limit]          Show recent trade episodes
  lessons                   List learned rules
  evolve                    Trigger threshold evolution
  config [key] [value]      Get/set config
  intelligence [source]     Refresh & show signals
  help                      Show this message
    `);
  },
};

const [,, , cmd, ...args] = process.argv;

if (commands[cmd]) {
  commands[cmd](args).catch(err => {
    console.error("Error:", err.message);
    process.exit(1);
  });
} else {
  console.log(`Unknown command: ${cmd}`);
  commands.help();
}
