/**
 * Camilla HTTP API Server
 * Exposes REST endpoints for frontend dashboard (Veloris) integration
 */

import express from "express";
import cors from "cors";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { Coordinator, state, learning, intelligence } from "./index.js";
import { getTopCandidates } from "./dlmm/pool-analyzer.js";
import { getMyPositions } from "./dlmm/position-manager.js";
import { getWalletBalances } from "./dlmm/wallet-ops.js";
import { IntelligenceCollector } from "./intelligence/collector.js";
import { Config } from "./config/index.js";
import { Logger } from "./utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const logger = new Logger("API");

const app = express();
const PORT = process.env.API_PORT || 3001;

// Global error handlers
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', err => {
  logger.error('Uncaught Exception:', err);
  process.exit(1);
});

// Middleware
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000").split(","),
  credentials: true,
}));
app.use(express.json());

// Request timeout middleware (30s default)
app.use((req, res, next) => {
  const timeout = parseInt(process.env.API_TIMEOUT || "30000");
  res.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(504).json({ error: "Request timeout" });
    }
  });
  next();
});

// Simple in-memory cache for expensive endpoints
const poolCache = {
  data: null,
  timestamp: 0,
  TTL: 30 * 1000, // 30 seconds
};

const invalidatePoolCache = () => { poolCache.data = null; poolCache.timestamp = 0; };

// ─── Health Check ────────────────────────────────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ─── Dashboard Stats ─────────────────────────────────────────────────────

app.get("/api/stats", async (req, res) => {
  try {
    const [positions, wallet] = await Promise.all([
      getMyPositions(),
      getWalletBalances(),
    ]);

    const intel = new IntelligenceCollector();
    const signals = await intel.getCurrentSignals();

    const stats = {
      wallet: {
        sol: wallet.sol,
        sol_usd: wallet.sol_usd,
      },
      positions: {
        total: positions.total_positions,
        in_range: positions.positions.filter(p => p.in_range).length,
        out_of_range: positions.positions.filter(p => !p.in_range).length,
      },
      intelligence: {
        signalCount: signals.signals.length,
        tokenCount: signals.tokenScores.length,
        lastRefresh: signals.lastRefresh,
      },
      config: {
        maxPositions: Config.load().risk.maxPositions,
        screeningInterval: Config.load().schedule.screeningIntervalMin,
        managementInterval: Config.load().schedule.managementIntervalMin,
      },
      lastUpdated: new Date().toISOString(),
    };

    res.json(stats);
  } catch (err) {
    logger.error("Stats error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Pool Candidates (for screening) ─────────────────────────────────────

app.get("/api/pools/candidates", async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const now = Date.now();

    // Check cache
    if (poolCache.data && (now - poolCache.timestamp) < poolCache.TTL) {
      const cached = poolCache.data;
      // Apply limit if changed
      const limited = cached.candidates.slice(0, parseInt(limit));
      return res.json({ ...cached, candidates: limited, cached: true });
    }

    const { candidates } = await getTopCandidates({ limit: parseInt(limit) });

    // Simplify response for frontend
    const simplified = candidates.map(c => ({
      pool: c.pool.pool,
      name: c.pool.name,
      baseMint: c.pool.base?.mint,
      quoteMint: c.pool.quote?.mint,
      feeTvlRatio: c.pool.fee_active_tvl_ratio,
      volume24h: c.pool.volume_window,
      tvl: c.pool.tvl,
      organicScore: c.pool.organic_score,
      binStep: c.pool.bin_step,
      smartMoneyCount: c.smart_money_count,
      kolCount: c.kol_count,
      intelligenceBoost: c.intelligence_boost,
      score: c.score,
      narrative: c.narrative,
      activeBin: c.activeBin,
    }));

    const result = { candidates: simplified, total: simplified.length, cached: false };
    poolCache.data = result;
    poolCache.timestamp = now;

    res.json(result);
  } catch (err) {
    logger.error("Candidates error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Invalidate cache when intelligence refreshes (optional endpoint)
app.post("/api/cache/invalidate", (req, res) => {
  invalidatePoolCache();
  res.json({ success: true, message: "Pool cache invalidated" });
});

// ─── Positions Detail ────────────────────────────────────────────────────

app.get("/api/positions", async (req, res) => {
  try {
    const positions = await getMyPositions();
    res.json(positions);
  } catch (err) {
    logger.error("Positions error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/positions/:positionId", async (req, res) => {
  try {
    const { positionId } = req.params;
    const positions = await getMyPositions();
    const position = positions.positions.find(p => p.position === positionId);
    if (!position) {
      return res.status(404).json({ error: "Position not found" });
    }
    res.json(position);
  } catch (err) {
    logger.error("Position detail error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Wallet Balances ─────────────────────────────────────────────────────

app.get("/api/wallet", async (req, res) => {
  try {
    const balances = await getWalletBalances();
    res.json(balances);
  } catch (err) {
    logger.error("Wallet error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Intelligence Signals ────────────────────────────────────────────────

app.get("/api/intelligence", async (req, res) => {
  try {
    // Refresh to get latest signals (may take a few seconds)
    await intelligence.refreshAll();
    const signals = await intelligence.getCurrentSignals();

    // Simplify for frontend
    const simplifiedSignals = signals.signals.map(s => ({
      source: s.source,
      type: s.signal_type,
      tokenMint: s.token_mint,
      confidence: s.confidence,
      timestamp: s.timestamp,
      data: s.data,
    }));

    res.json({
      signals: simplifiedSignals,
      tokenScores: signals.tokenScores,
      confidenceScore: signals.confidenceScore,
      lastRefresh: signals.lastRefresh,
    });
  } catch (err) {
    logger.error("Intelligence error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Pool Discovery (raw Meteora data) ───────────────────────────────────

app.get("/api/pools/discovery", async (req, res) => {
  try {
    const { page_size = 50, category = "trending" } = req.query;
    const { discoverPools } = await import("./dlmm/discovery.js");
    const result = await discoverPools({
      page_size: parseInt(page_size),
      category: category as string,
    });

    // Simplify pools
    const pools = result.pools.map(p => ({
      pool: p.pool,
      name: p.name,
      base: p.base,
      quote: p.quote,
      tvl: p.tvl,
      volume24h: p.volume_24h,
      volumeWindow: p.volume_window,
      feeActiveTvlRatio: p.fee_active_tvl_ratio,
      organicScore: p.organic_score,
      binStep: p.bin_step,
      poolType: p.pool_type,
    }));

    res.json({ total: result.total, pools });
  } catch (err) {
    logger.error("Discovery error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Learning & Episodes ─────────────────────────────────────────────────

app.get("/api/episodes", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const episodes = learning.getRecentEpisodes(parseInt(limit));
    res.json({ episodes });
  } catch (err) {
    logger.error("Episodes error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/lessons", async (req, res) => {
  try {
    const { minConfidence = 0.6, limit = 10 } = req.query;
    const lessons = learning.getLessonsForPrompt(parseFloat(minConfidence), parseInt(limit));
    res.json({ lessons });
  } catch (err) {
    logger.error("Lessons error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Performance Summary ────────────────────────────────────────────────

app.get("/api/performance", async (req, res) => {
  try {
    const summary = learning.getPerformanceSummary();
    res.json(summary);
  } catch (err) {
    logger.error("Performance error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Configuration (sanitized) ───────────────────────────────────────────

app.get("/api/config", (req, res) => {
  try {
    const config = Config.load();
    // Remove sensitive data
    const sanitized = {
      risk: config.risk,
      screening: config.screening,
      management: config.management,
      learning: config.learning,
      intelligence: {
        sources: Object.fromEntries(
          Object.entries(config.intelligence.sources).map(([k, v]) => [
            k,
            { enabled: v.enabled }
          ])
        ),
        signalFusion: config.intelligence.signalFusion,
      },
      schedule: config.schedule,
      llm: {
        managementModel: config.llm.managementModel,
        screeningModel: config.llm.screeningModel,
        generalModel: config.llm.generalModel,
        temperature: config.llm.temperature,
      },
      telegram: { enabled: config.telegram.enabled },
    };
    res.json(sanitized);
  } catch (err) {
    logger.error("Config error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Trigger Actions ─────────────────────────────────────────────────────

app.post("/api/actions/screen", async (req, res) => {
  try {
    const coordinator = new Coordinator();
    const result = await coordinator.runScreeningCycle();
    res.json({ success: true, result });
  } catch (err) {
    logger.error("Screen action error:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/actions/manage", async (req, res) => {
  try {
    const coordinator = new Coordinator();
    const result = await coordinator.runManagementCycle();
    res.json({ success: true, result });
  } catch (err) {
    logger.error("Manage action error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Error Handler ───────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  logger.error("Unhandled API error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ─── Start Server ────────────────────────────────────────────────────────

let server = null;
let coordinator = null;

export async function startAPIServer() {
  // Ensure DB connections are established (needed for standalone API server)
  if (!state.state) {
    await state.connect();
  }
  if (!learning.db) {
    await learning.connect();
  }

  // Initialize coordinator (but don't start cycles twice)
  coordinator = new Coordinator();

  server = app.listen(PORT, () => {
    logger.info(`Camilla API server listening on http://localhost:${PORT}`);
    logger.info(`Endpoints:`);
    logger.info(`  GET /health`);
    logger.info(`  GET /api/stats`);
    logger.info(`  GET /api/pools/candidates`);
    logger.info(`  GET /api/positions`);
    logger.info(`  GET /api/wallet`);
    logger.info(`  GET /api/intelligence`);
    logger.info(`  GET /api/episodes`);
    logger.info(`  GET /api/lessons`);
    logger.info(`  GET /api/performance`);
    logger.info(`  POST /api/actions/screen`);
    logger.info(`  POST /api/actions/manage`);
  });

  // Return server instance for graceful shutdown in main process
  return server;
}

// If run directly (node api-server.js)
if (import.meta.url === `file://${process.argv[1]}`) {
  startAPIServer().catch(err => {
    logger.error("Failed to start API server:", err);
    process.exit(1);
  });
}

export { app, startAPIServer };
