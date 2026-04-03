/**
 * KOL (Key Opinion Leader) Tracker
 *
 * Monitors influential wallet addresses for LP activity.
 * Detects when KOLs enter/exit pools and provides consensus signals.
 */
import { Config } from "../config/index.js";
import { Logger } from "../utils/logger.js";
import { getMyPositions, getActiveBin } from "../dlmm/position-manager.js";

const logger = new Logger("KOL-TRACKER");

export default class KOLTracker {
  constructor() {
    this.trackedWallets = new Set(Config.load().intelligence.sources.kol.trackedWallets);
    this.walletPerformance = new Map(); // cache performance
  }

  async fetch() {
    const signals = [];

    if (!this.trackedWallets.size) return signals;

    try {
      // We'll use the LPAgent API to see recent activity
      for (const wallet of this.trackedWallets) {
        const activity = await this.getWalletActivity(wallet);
        if (activity.recentEntries.length > 0) {
          signals.push({
            wallet_address: wallet,
            pool_address: activity.recentEntries[0].pool, // latest entry
            source: "kol",
            signal_type: "entry",
            confidence: this.calculateConfidence(activity),
            data: {
              wallet,
              recent_entries: activity.recentEntries,
              avg_apr: activity.avgApr,
              win_rate: activity.winRate,
            },
            timestamp: Date.now(),
          });
        }
      }
    } catch (err) {
      logger.error("KOL fetch failed:", err.message);
    }

    return signals;
  }

  async getWalletActivity(walletAddress) {
    try {
      const response = await fetch(
        `https://datapi.meteora.ag/v1/wallet-positions?wallet=${walletAddress}&limit=20`
      );
      if (!response.ok) return { recentEntries: [], avgApr: 0, winRate: 0 };

      const data = await response.json();
      const positions = data.positions || [];

      // Get recent entries (opened in last 12h)
      const recent = positions.filter(p => {
        const opened = new Date(p.opened_at);
        return (Date.now() - opened.getTime()) < 12 * 60 * 60 * 1000;
      }).map(p => ({
        pool: p.pool_address,
        opened_at: p.opened_at,
        position_value_usd: p.position_value_usd,
        apr: p.apr,
      }));

      // Overall performance (mock — should be fetched from LPAgent aggregated stats)
      const avgApr = positions.length > 0
        ? positions.reduce((sum, p) => sum + (p.apr || 0), 0) / positions.length
        : 0;
      const winRate = positions.length > 0
        ? positions.filter(p => p.pnl_pct > 0).length / positions.length
        : 0;

      return { recentEntries: recent, avgApr, winRate };
    } catch (err) {
      logger.error(`Failed to fetch KOL activity for ${walletAddress}:`, err.message);
      return { recentEntries: [], avgApr: 0, winRate: 0 };
    }
  }

  calculateConfidence(activity) {
    if (activity.recentEntries.length === 0) return 0;

    // Multiple recent entries = strong signal
    const entryBonus = Math.min(activity.recentEntries.length * 0.1, 0.3);

    // High APR & win rate = more trustworthy KOL
    const performanceBonus = (activity.avgApr / 100) * 0.3 + activity.winRate * 0.3;

    return Math.min(1, 0.5 + entryBonus + performanceBonus);
  }

  /**
   * Check if any tracked KOLs are active in this pool
   */
  async checkKOLsInPool(poolAddress) {
    try {
      const participants = await getPoolLPers(poolAddress, 50);
      const kolPresent = participants.filter(p => this.trackedWallets.has(p.address));

      return {
        kol_count: kolPresent.length,
        kol_wallets: kolPresent.map(k => ({
          address: k.address,
          position_value_usd: k.position_value_usd,
          apr: k.apr,
        })),
      };
    } catch (err) {
      logger.error(`KOL check failed for ${poolAddress}:`, err.message);
      return { kol_count: 0, kol_wallets: [] };
    }
  }
}

async function getPoolLPers(poolAddress, limit = 20) {
  const response = await fetch(
    `https://datapi.meteora.ag/v1/pool-lpers?pool=${poolAddress}&limit=${limit}`
  );
  if (!response.ok) return [];
  const data = await response.json();
  return data.lpers || [];
}
