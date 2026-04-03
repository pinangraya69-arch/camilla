/**
 * Pool Analyzer — Screening with Intelligence Boost
 *
 * Fetches candidate pools from Meteora API, enriches with:
 * - OKX advanced info
 * - Smart money check
* - KOL presence
* - X/Discord sentiment
* - Pool memory (past performance)
*
* Returns top N ranked candidates.
*/

import { discoverPools } from "./discovery.js";
import { Config } from "../config/index.js";
import { IntelligenceCollector } from "../intelligence/collector.js";
import { Logger } from "../utils/logger.js";
import { studyTopLPers } from "../tools/smart-wallets.js";
import { StateManager } from "../core/memory.js";
import { getMyPositions } from "./position-manager.js";

const logger = new Logger("POOL-ANALYZER");

export async function getTopCandidates({ limit = 10 } = {}) {
  const config = Config.load();
  const intelligence = new IntelligenceCollector();

  // Step 1: Get pools from discovery API
  const { pools } = await discoverPools({ page_size: 50 });

  // Step 2: Exclude already occupied pools & mints
  const { positions } = await getMyPositions();
  const occupiedPools = new Set(positions.map(p => p.pool));
  const occupiedMints = new Set(positions.map(p => p.base_mint).filter(Boolean));

  let eligible = pools.filter(p =>
    !occupiedPools.has(p.pool) && !occupiedMints.has(p.base?.mint)
  );

  // Step 3: Enrich with OKX data (happens in discoverPools already if integrated)
  // Step 4: Add smart money & KOL checks
  const enriched = await Promise.allSettled(
    eligible.map(async (pool) => {
      const [smartResult, kolResult, intelBoost, memory] = await Promise.all([
        checkSmartWalletsOnPool({ pool_address: pool.pool }),
        checkKOLsInPool(pool.pool),
        intelligence.calculateConfidenceBoost(pool),
        recallForPool(pool.pool),
      ]);

      return {
        ...pool,
        smart_money_count: smartResult.status === "fulfilled" ? smartResult.value.count : 0,
        kol_count: kolResult.status === "fulfilled" ? kolResult.value.kol_count : 0,
        intelligence_boost: intelBoost,
        memory: memory,
        score: computeScore(pool, {
          smart_money: smartResult.status === "fulfilled" ? smartResult.value.count : 0,
          kol: kolResult.status === "fulfilled" ? kolResult.value.kol_count : 0,
          intel_boost: intelBoost,
        }),
      };
    })
  );

  const finalized = enriched
    .filter(r => r.status === "fulfilled")
    .map(r => r.value)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  logger.info(`Screening: ${eligible.length} → ${finalized.length} top candidates`);
  return { candidates: finalized, total_eligible: eligible.length };
}

function computeScore(pool, boosts) {
  const base =
    (pool.fee_active_tvl_ratio * 100) * 0.3 +
    (pool.organic_score / 100) * 0.25 +
    Math.min(pool.volume_window / 10000, 1) * 0.2 +
    (boosts.smart_money > 0 ? 0.1 : 0) +
    (boosts.kol > 0 ? 0.1 : 0) +
    boosts.intel_boost;

  return Math.min(100, base * 100);
}

async function checkSmartWalletsOnPool({ pool_address }) {
  const topLPers = await studyTopLPers(pool_address, 30);
  const smart = topLPers.filter(w => {
    const winRate = w.win_rate || (w.wins / (w.wins + w.losses));
    const apr = w.avg_apr || w.apr || 0;
    const value = w.position_value_usd || w.value_usd || 0;
    return winRate > 0.6 && apr > 10 && value > 1000;
  });

  return {
    in_pool: smart,
    count: smart.length,
    total_value_usd: smart.reduce((sum, w) => sum + (w.position_value_usd || w.value_usd || 0), 0),
  };
}

function checkKOLsInPool(poolAddress) {
  // Use same smart money as KOL proxy (can be expanded with dedicated KOL list)
  return checkSmartWalletsOnPool({ pool_address: poolAddress });
}

function recallForPool(pool) {
  // For singleton instance, we'll instantiate a temporary one if needed
  const state = new StateManager();
  // Note: sync vs async — this is called from async context so connect() will be handled upstream
  return state.recallForPool(pool);
}
