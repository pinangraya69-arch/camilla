import { LearningEngine } from "../core/learner.js";
import { StateManager } from "../core/memory.js";
import { getMyPositions } from "../dlmm/position-manager.js";
import { getWalletBalances } from "../dlmm/wallet-ops.js";

/**
 * Generate morning briefing HTML
 */
export async function generateBriefing() {
  const learning = new LearningEngine();
  const state = new StateManager();
  await state.connect();

  const positions = await getMyPositions();
  const balance = await getWalletBalances();
  const performance = learning.getPerformanceSummary();
  const recentEpisodes = state.getRecentEpisodes(5);

  const html = `
╔═══════════════════════════════════════════╗
║         🌅 MORNING BRIEFING              ║
╚═══════════════════════════════════════════╝

📊 **PORTFOLIO**
• Wallet: ${balance.sol.toFixed(3)} SOL ($${balance.sol_usd.toFixed(2)})
• Open Positions: ${positions.total_positions}
${positions.positions.map(p => `  - ${p.pair}: $${p.total_value_usd} | PnL: ${p.pnl_pct}%`).join("\n") || "  None"}

📈 **PERFORMANCE (all time)**
• Total Episodes: ${performance.totalEpisodes}
• Win Rate: ${performance.winRate}
• Avg PnL: ${performance.avgPnl}
${performance.byRegime.map(r => `  • ${r.market_regime}: ${r.win_rate.toFixed(1)}% win rate (${r.count} deploys)`).join("\n")}

🎯 **RECENT TRADES**
${recentEpisodes.map((ep, i) => `
${i+1}. ${ep.decision.pool_name || ep.decision.pool?.slice(0, 8)}
   PnL: ${ep.outcome.pnl_pct.toFixed(2)}% (${ep.outcome.close_reason})
   Strategy: ${ep.decision.strategy_used?.lp_strategy || "unknown"}
`).join("\n") || "  No recent closed positions"}

🔮 **INTELLIGENCE SIGNALS**
[Placeholder — integrate signal strength summary]

⏰ **SCHEDULE**
• Management: every ${(await import("../config/index.js")).Config.load().schedule.managementIntervalMin} min
• Screening: every ${(await import("../config/index.js")).Config.load().schedule.screeningIntervalMin} min
• Intel refresh: every ${(await import("../config/index.js")).Config.load().schedule.intelligenceRefreshMin} min

🔄 **Next evolution**: ${performance.totalEpisodes >= 10 ? "Ready — run /evolve" : `${10 - performance.totalEpisodes} episodes needed`}

_Generated at ${new Date().toISOString()}_
`;

  return html;
}
