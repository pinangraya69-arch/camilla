import { Config } from "../config/index.js";
import XSignals from "./x-signals.js";
import DiscordScraper from "./discord-scraper.js";
import SmartMoney from "./smart-money.js";
import KOLTracker from "./kol-tracker.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("INTEL");

/**
 * Central intelligence aggregation engine.
 * Collects signals from all sources, fuses them, and provides unified view.
 */
export class IntelligenceCollector {
  constructor() {
    this.sources = {
      x: new XSignals(),
      discord: new DiscordScraper(),
      smartMoney: new SmartMoney(),
      kol: new KOLTracker(),
    };
    this.signalCache = [];
    this.lastRefresh = null;
    this.MAX_CACHE_SIZE = 1000; // Prevent unbounded growth
    this.MAX_SIGNAL_AGE_HOURS = 24; // Auto-evict signals older than this
  }

  async refreshAll() {
    logger.info("Refreshing intelligence sources...");
    const freshSignals = [];

    for (const [name, source] of Object.entries(this.sources)) {
      if (!Config.load().intelligence.sources[name]?.enabled) {
        logger.debug(`Source ${name} disabled — skipping`);
        continue;
      }

      try {
        const signals = await source.fetch();
        logger.info(`Fetched ${signals.length} signals from ${name}`);
        freshSignals.push(...signals.map(s => ({ ...s, source: name })));
      } catch (err) {
        logger.error(`Failed to fetch ${name}:`, err.message);
      }
    }

    // Merge with cache, apply decay
    this.mergeAndDecay(freshSignals);

    logger.info(`Intelligence cache now has ${this.signalCache.length} active signals`);
    this.lastRefresh = new Date();
  }

  mergeAndDecay(newSignals) {
    const now = Date.now();
    const decayRate = Config.load().intelligence.signalFusion.decayRate;

    // Decay existing signals
    for (const sig of this.signalCache) {
      const ageHours = (now - sig.timestamp) / (1000 * 60 * 60);
      sig.confidence *= Math.pow(decayRate, ageHours);
    }

    // Remove low confidence & expired signals, then enforce max size
    this.cleanupCache(now);

    // Add new signals (dedup by token + source + type)
    for (const ns of newSignals) {
      const duplicate = this.signalCache.find(s =>
        s.token_mint === ns.token_mint &&
        s.source === ns.source &&
        s.signal_type === ns.signal_type &&
        (now - s.timestamp) < 60 * 60 * 3 // 3h dedup window
      );
      if (!duplicate) {
        ns.timestamp = now;
        this.signalCache.push(ns);
      }
    }

    // Enforce max size after adding (LRU: remove oldest)
    if (this.signalCache.length > this.MAX_CACHE_SIZE) {
      this.signalCache.sort((a, b) => b.timestamp - a.timestamp); // newest first
      this.signalCache = this.signalCache.slice(0, this.MAX_CACHE_SIZE);
    }

    logger.debug(`Signal cache: ${this.signalCache.length} entries after merge`);
  }

  cleanupCache(now = Date.now()) {
    const cutoff = now - this.MAX_SIGNAL_AGE_HOURS * 60 * 60 * 1000;
    const before = this.signalCache.length;
    this.signalCache = this.signalCache.filter(s => s.confidence > 0.1 && s.timestamp > cutoff);
    const removed = before - this.signalCache.length;
    if (removed > 0) {
      logger.debug(`Cleaned ${removed} stale/low-confidence signals`);
    }
  }

  async getCurrentSignals() {
    const now = Date.now();
    const recent = this.signalCache.filter(s => {
      const ageHours = (now - s.timestamp) / (1000 * 60 * 60);
      return ageHours < 24; // only consider last 24h
    });

    // Group by token
    const byToken = {};
    for (const sig of recent) {
      if (!byToken[sig.token_mint]) {
        byToken[sig.token_mint] = { mint: sig.token_mint, signals: [], scores: [] };
      }
      byToken[sig.token_mint].signals.push(sig);
      byToken[sig.token_mint].scores.push(sig.confidence);
    }

    // Compute aggregate scores
    const tokenScores = Object.values(byToken).map(t => ({
      ...t,
      aggregateScore: this.weightedAverage(t.scores),
      sourceCount: new Set(t.signals.map(s => s.source)).size,
    }));

    // Global signal strength
    const avgConfidence = this.weightedAverage(recent.map(s => s.confidence));

    return {
      signals: recent,
      tokenScores,
      confidenceScore: avgConfidence,
      sources: [...new Set(recent.map(s => s.source))],
      lastRefresh: this.lastRefresh,
    };
  }

  weightedAverage(values) {
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  async getSignalsForToken(tokenMint) {
    const current = await this.getCurrentSignals();
    return current.tokenScores.find(t => t.mint === tokenMint) || null;
  }

  // Quick boost calculation for screening
  async calculateConfidenceBoost(pool) {
    const signals = await this.getCurrentSignals();
    const tokenScore = signals.tokenScores.find(t => t.mint === pool.base?.mint);

    if (!tokenScore) return 0;

    const base = tokenScore.aggregateScore;
    const sourceBonus = tokenScore.sourceCount >= 2 ? 0.1 : 0;
    const recencyBonus = (Date.now() - signals.lastRefresh) < 3600000 ? 0.05 : 0;

    return Math.min(1, base + sourceBonus + recencyBonus);
  }
}

export { IntelligenceCollector };
