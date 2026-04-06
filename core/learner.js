import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../config/index.js";
import { Logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "../../data/camilla.db");
const logger = new Logger("LEARNER");

export class LearningEngine {
  constructor() {
    this.db = null;
  }

  async connect() {
    if (this.db) return;

    // Ensure data directory exists
    const fs = await import("fs");
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.initializeSchema();
    logger.info("Connected to learning database");
  }

  disconnect() {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info("Learning database connection closed");
    }
  }

  initializeSchema() {
    // Episodes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS episodes (
        id TEXT PRIMARY KEY,
        timestamp TEXT,
        context_json TEXT,
        decision_json TEXT,
        outcome_json TEXT,
        lessons_json TEXT,
        pnl_pct REAL,
        close_reason TEXT,
        strategy_used TEXT,
        market_regime TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_episodes_timestamp ON episodes(timestamp);
      CREATE INDEX IF NOT EXISTS idx_episodes_regime ON episodes(market_regime);
      CREATE INDEX IF NOT EXISTS idx_episodes_strategy ON episodes(strategy_used);
    `);

    // Lessons table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        rule TEXT,
        confidence REAL,
        tags_json TEXT,
        source_episodes_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_applied_at TEXT,
        success_correlation REAL
      );

      CREATE INDEX IF NOT EXISTS idx_lessons_confidence ON lessons(confidence DESC);
    `);

    // Strategy performance
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS strategy_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        strategy_id TEXT,
        regime TEXT,
        deployments INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        total_pnl_pct REAL DEFAULT 0,
        avg_pnl_pct REAL DEFAULT 0,
        last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(strategy_id, regime)
      );
    `);
  }

  /**
   * Record a completed episode (deploy → close cycle)
   */
  async recordEpisode(episode) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO episodes
      (id, timestamp, context_json, decision_json, outcome_json, lessons_json, pnl_pct, close_reason, strategy_used, market_regime)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      episode.id,
      episode.timestamp,
      JSON.stringify(episode.context),
      JSON.stringify(episode.decision),
      JSON.stringify(episode.outcome),
      JSON.stringify(episode.lessons || []),
      episode.outcome.pnl_pct,
      episode.outcome.close_reason,
      episode.decision.strategy_used?.lp_strategy || "unknown",
      episode.context.market_regime
    );

    // Update strategy performance
    await this.updateStrategyPerformance(episode);

    // Generate lessons
    const lessons = await this.deriveLessons(episode);
    for (const lesson of lessons) {
      await this.upsertLesson(lesson);
    }

    logger.info(`Recorded episode ${episode.id.slice(0, 8)} — PnL: ${episode.outcome.pnl_pct}%`);
  }

  async updateStrategyPerformance(episode) {
    const regime = episode.context.market_regime || "unknown";
    const strategy = episode.decision.strategy_used?.lp_strategy || "unknown";
    const win = episode.outcome.pnl_pct > 0 ? 1 : 0;

    const existing = this.db.prepare(`
      SELECT * FROM strategy_performance WHERE strategy_id = ? AND regime = ?
    `).get(strategy, regime);

    if (existing) {
      const newDeployments = existing.deployments + 1;
      const newWins = existing.wins + win;
      const newTotalPnl = existing.total_pnl_pct + episode.outcome.pnl_pct;
      const newAvg = newTotalPnl / newDeployments;

      this.db.prepare(`
        UPDATE strategy_performance
        SET deployments = ?, wins = ?, total_pnl_pct = ?, avg_pnl_pct = ?, last_updated = ?
        WHERE strategy_id = ? AND regime = ?
      `).run(newDeployments, newWins, newTotalPnl, newAvg, new Date().toISOString(), strategy, regime);
    } else {
      this.db.prepare(`
        INSERT INTO strategy_performance (strategy_id, regime, deployments, wins, total_pnl_pct, avg_pnl_pct)
        VALUES (?, ?, 1, ?, ?, ?)
      `).run(strategy, regime, win, episode.outcome.pnl_pct, episode.outcome.pnl_pct);
    }
  }

  /**
   * Derive lessons from an episode using pattern recognition
   */
  async deriveLessons(episode) {
    const lessons = [];

    // Pattern: High volatility + wide bins → better range efficiency
    const vol = episode.context.volatility_index;
    const binsTotal = (episode.decision.bins_below || 0) + (episode.decision.bins_above || 0);
    const rangeEff = episode.outcome.minutes_in_range / (episode.outcome.minutes_held || 1);

    if (vol > 4 && binsTotal > 60 && rangeEff > 0.7) {
      lessons.push({
        rule: "High volatility (>4) + wide bins (>60) yields >70% range efficiency",
        tags: ["volatility", "range_calibration"],
        confidence: 0.8,
        source_episode: episode.id
      });
    }

    // Pattern: Smart money present → higher win rate
    const sm = episode.decision.intelligence_signals?.smart_money_present;
    if (sm && episode.outcome.pnl_pct > 0) {
      lessons.push({
        rule: "Smart money presence correlates with positive PnL",
        tags: ["smart_money", "signal_validation"],
        confidence: 0.7,
        source_episode: episode.id
      });
    }

    // Pattern: Low fee/tvl + early close
    const feeTvl = episode.decision.pool_metrics?.fee_active_tvl_ratio;
    if (feeTvl < 0.03 && episode.outcome.minutes_held < 120) {
      lessons.push({
        rule: "Low fee/TVL pools (<0.03) tend to exit early (<2h)",
        tags: ["fee_quality", "exit_timing"],
        confidence: 0.6,
        source_episode: episode.id
      });
    }

    // Outcome-based meta-lesson
    if (episode.outcome.pnl_pct > 8) {
      lessons.push({
        rule: `Strong win (+${episode.outcome.pnl_pct.toFixed(1)}%) — replicate conditions: volatility=${vol}, bins=${binsTotal}, smart_money=${sm}`,
        tags: ["win_pattern"],
        confidence: 0.9,
        source_episode: episode.id
      });
    } else if (episode.outcome.pnl_pct < -10) {
      lessons.push({
        rule: `Significant loss (${episode.outcome.pnl_pct.toFixed(1)}%) — avoid: volatility=${vol}, fee_tvl=${feeTvl}`,
        tags: ["loss_pattern", "risk_avoidance"],
        confidence: 0.85,
        source_episode: episode.id
      });
    }

    return lessons;
  }

  async upsertLesson(lesson) {
    const existing = this.db.prepare("SELECT * FROM lessons WHERE rule = ?").get(lesson.rule);

    if (existing) {
      // Update confidence with moving average
      const newConf = (existing.confidence * 0.7) + (lesson.confidence * 0.3);
      this.db.prepare(`
        UPDATE lessons
        SET confidence = ?, source_episodes_json = ?, last_applied_at = ?
        WHERE id = ?
      `).run(
        newConf,
        JSON.stringify(JSON.parse(existing.source_episodes_json || "[]").concat(lesson.source_episode)),
        new Date().toISOString(),
        existing.id
      );
    } else {
      const id = `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      this.db.prepare(`
        INSERT INTO lessons (id, rule, confidence, tags_json, source_episodes_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        id,
        lesson.rule,
        lesson.confidence,
        JSON.stringify(lesson.tags),
        JSON.stringify([lesson.source_episode])
      );
    }
  }

  /**
   * Get all high-confidence lessons for prompt injection
   */
  getLessonsForPrompt(minConfidence = 0.6, limit = 10) {
    const rows = this.db.prepare(`
      SELECT * FROM lessons
      WHERE confidence >= ?
      ORDER BY confidence DESC, last_applied_at DESC
      LIMIT ?
    `).all(minConfidence, limit);

    return rows.map(r => ({
      rule: r.rule,
      confidence: r.confidence,
      tags: JSON.parse(r.tags_json || "[]")
    }));
  }

  /**
   * Evolve screening thresholds based on performance
   */
  async evolveThresholds() {
    const cfg = Config.load();
    const minEpisodes = cfg.learning.minPositionsToEvolve;

    // Check we have enough episodes
    const count = this.db.prepare("SELECT COUNT(*) as c FROM episodes").get().c;
    if (count < minEpisodes) {
      return { success: false, reason: `Need ${minEpisodes} episodes (have ${count})` };
    }

    const changes = {};

    // Analyze each threshold parameter by performance correlation
    const thresholdsToEvolve = [
      "screening.minFeeActiveTvlRatio",
      "screening.minOrganic",
      "screening.minHolders",
      "screening.maxBotHoldersPct",
      "screening.maxTop10Pct",
      "management.outOfRangeWaitMinutes",
    ];

    for (const key of thresholdsToEvolve) {
      const correlation = this.analyzeThresholdPerformance(key);
      if (correlation && Math.abs(correlation) > 0.3) {
        const direction = correlation > 0 ? 1.05 : 0.95; // positive corr → increase threshold (tighter), negative → loosen
        changes[key] = direction;
      }
    }

    if (Object.keys(changes).length === 0) {
      return { success: false, reason: "No significant threshold changes identified" };
    }

    // Apply changes (clamped by evolutionStrength)
    const applied = Config.evolveThresholds(changes);
    logger.info(`Evolved thresholds: ${JSON.stringify(applied)}`);

    return { success: true, changes: applied };
  }

  /**
   * Analyze correlation between threshold values and PnL
   */
  analyzeThresholdPerformance(thresholdKey) {
    // Simplified: group episodes by threshold ranges and compare win rates
    // In production: use proper statistical correlation
    return null; // placeholder
  }

  /**
   * Get performance summary for dashboard
   */
  getPerformanceSummary() {
    const total = this.db.prepare("SELECT COUNT(*) as c FROM episodes").get().c;
    const wins = this.db.prepare("SELECT COUNT(*) as c FROM episodes WHERE pnl_pct > 0").get().c;
    const avgPnl = this.db.prepare("SELECT AVG(pnl_pct) as avg FROM episodes").get().avg || 0;

    const byRegime = this.db.prepare(`
      SELECT market_regime, COUNT(*) as count, AVG(pnl_pct) as avg_pnl, SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as win_rate
      FROM episodes
      GROUP BY market_regime
    `).all();

    const byStrategy = this.db.prepare(`
      SELECT strategy_used, COUNT(*) as count, AVG(pnl_pct) as avg_pnl, SUM(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END) * 1.0 / COUNT(*) as win_rate
      FROM episodes
      GROUP BY strategy_used
    `).all();

    return {
      totalEpisodes: total,
      totalWins: wins,
      winRate: total > 0 ? (wins / total * 100).toFixed(1) + "%" : "N/A",
      avgPnl: avgPnl.toFixed(2) + "%",
      byRegime,
      byStrategy,
    };
  }

  /**
   * Get strategy recommendations based on performance
   */
  getBestStrategyForRegime(regime) {
    const rows = this.db.prepare(`
      SELECT strategy_id, avg_pnl_pct, win_rate, deployments
      FROM strategy_performance
      WHERE regime = ?
      ORDER BY avg_pnl_pct DESC
      LIMIT 3
    `).all(regime);

    return rows;
  }

  /**
   * Learn from recent episodes: adjust weights dynamically
   */
  async continuousLearning() {
    const recent = this.db.prepare(`
      SELECT * FROM episodes
      WHERE timestamp > datetime('now', '-1 day')
      ORDER BY timestamp DESC
      LIMIT 20
    `).all();

    if (recent.length < 5) return;

    const recentPnls = recent.map(e => e.pnl_pct);
    const avgRecent = recentPnls.reduce((a, b) => a + b, 0) / recentPnls.length;

    if (avgRecent < -5) {
      logger.warn(`Recent avg PnL: ${avgRecent.toFixed(2)}% — consider tightening filters`);
      const result = await this.evolveThresholds();
      if (result.success) {
        logger.info(`Auto-evolved: ${JSON.stringify(result.changes)}`);
      }
    }
  }

  getRecentEpisodes(limit = 20) {
    const rows = this.db.prepare(`
      SELECT * FROM episodes
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limit);

    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      context: JSON.parse(r.context_json),
      decision: JSON.parse(r.decision_json),
      outcome: JSON.parse(r.outcome_json),
      lessons: JSON.parse(r.lessons_json || "[]"),
      pnl_pct: r.pnl_pct,
      close_reason: r.close_reason,
      strategy_used: r.strategy_used,
      market_regime: r.market_regime,
    }));
  }
}

export { LearningEngine };
