/**
 * Smart Money Intelligence
 *
 * Tracks top-performing LP wallets, detects their entries/exits,
 * and surfaces pools with smart money presence.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import fetch from "node-fetch";
import { Config } from "../config/index.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("SMART-MONEY");

const DATAPI_LP = "https://datapi.meteora.ag/v1";

export default class SmartMoney {
  constructor() {
    this.connection = new Connection(process.env.RPC_URL, "confirmed");
    this.trackedWallets = new Set();
    this.cache = new Map();
  }

  async fetch() {
    const signals = [];
    const now = Date.now();

    try {
      // Fetch recent LP activity from LPAgent API (Meteora)
      const res = await fetch(`${DATAPI_LP}/top-lpers?limit=50`);
      if (!res.ok) throw new Error(`LPAgent API: ${res.status}`);

      const data = await res.json();
      const topLPers = data.lpers || [];

      // Filter to only tracked smart wallets (performant ones)
      const smartWallets = topLPers.filter(lp =>
        lp.win_rate > 0.6 && lp.avg_apr > 10 && lp.total_positions >= 10
      );

      for (const wallet of smartWallets) {
        // Check if wallet has recent position changes
        const recentPools = await this.getWalletRecentPools(wallet.address, hoursAgo: 6);

        for (const pool of recentPools) {
          signals.push({
            wallet_address: wallet.address,
            pool_address: pool,
            source: "smart_money",
            signal_type: "entry", // or "exit" if we detect close
            confidence: wallet.win_rate * wallet.avg_apr / 100, // normalized
            data: {
              wallet_performance: {
                win_rate: wallet.win_rate,
                avg_apr: wallet.avg_apr,
                total_positions: wallet.total_positions,
              },
              timestamp: now,
            },
            timestamp: now,
          });
        }
      }
    } catch (err) {
      logger.error("Smart money fetch failed:", err.message);
    }

    return signals;
  }

  async getWalletRecentPools(walletAddress, hoursAgo = 6) {
    const cacheKey = `${walletAddress}:${hoursAgo}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // Use Meteora DLMM API to get wallet positions
      const res = await fetch(`${DATAPI_LP}/wallet-positions?wallet=${walletAddress}&limit=20`);
      if (!res.ok) return [];

      const data = await res.json();
      const positions = data.positions || [];

      const recent = positions.filter(pos => {
        const openedAt = new Date(pos.opened_at);
        const hoursDiff = (Date.now() - openedAt.getTime()) / (1000 * 60 * 60);
        return hoursDiff <= hoursAgo;
      }).map(p => p.pool_address);

      this.cache.set(cacheKey, recent);
      return recent;
    } catch (err) {
      logger.error(`Failed to get wallet pools for ${walletAddress}:`, err.message);
      return [];
    }
  }

  /**
   * Check if any smart money wallets are present in a pool
   */
  async checkSmartWalletsOnPool(poolAddress) {
    try {
      const res = await fetch(`${DATAPI_LP}/pool-lpers?pool=${poolAddress}&limit=50`);
      if (!res.ok) return { in_pool: [], count: 0 };

      const data = await res.json();
      const lpers = data.lpers || [];

      // Filter to smart criteria
      const smart = lpers.filter(lp =>
        lp.win_rate > 0.6 && lp.avg_apr > 10 && lp.position_value_usd > 1000
      ).map(lp => ({
        address: lp.address,
        win_rate: lp.win_rate,
        apr: lp.avg_apr,
        position_value: lp.position_value_usd,
        hold_minutes: lp.hold_minutes,
      }));

      return {
        in_pool: smart,
        count: smart.length,
        total_value_usd: smart.reduce((sum, s) => sum + s.position_value, 0),
      };
    } catch (err) {
      logger.error(`Smart wallet check failed for ${poolAddress}:`, err.message);
      return { in_pool: [], count: 0 };
    }
  }
}
