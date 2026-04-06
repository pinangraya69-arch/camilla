import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "../../data/state.json");
const MEMORY_FILE = path.join(__dirname, "../../data/memory.json");
const logger = new Logger("MEMORY");

export class StateManager {
  constructor() {
    this.state = null;
    this.memory = null;
    this.lastStateSave = 0;
    this.lastMemorySave = 0;
    this.SAVE_DEBOUNCE_MS = 5000; // Min 5s between saves
    this.pendingState = false;
    this.pendingMemory = false;
  }

  async connect() {
    const fs = await import("fs");
    if (!fs.existsSync(path.dirname(STATE_FILE))) {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    }

    this.state = this.loadState();
    this.memory = this.loadMemory();
    logger.info("State manager initialized");
  }

  // Debounced save — coalesces rapid writes
  saveState() {
    const now = Date.now();
    if (now - this.lastStateSave < this.SAVE_DEBOUNCE_MS) {
      if (!this.pendingState) {
        this.pendingState = true;
        setTimeout(() => this._flushState(), this.SAVE_DEBOUNCE_MS);
      }
      return;
    }
    this._flushState();
  }

  _flushState() {
    try {
      this.state.lastUpdated = new Date().toISOString();
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
      this.lastStateSave = Date.now();
      this.pendingState = false;
    } catch (err) {
      logger.error("Failed to save state.json:", err.message);
    }
  }

  saveMemory() {
    const now = Date.now();
    if (now - this.lastMemorySave < this.SAVE_DEBOUNCE_MS) {
      if (!this.pendingMemory) {
        this.pendingMemory = true;
        setTimeout(() => this._flushMemory(), this.SAVE_DEBOUNCE_MS);
      }
      return;
    }
    this._flushMemory();
  }

  _flushMemory() {
    try {
      this.memory.lastUpdated = new Date().toISOString();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memory, null, 2));
      this.lastMemorySave = Date.now();
      this.pendingMemory = false;
    } catch (err) {
      logger.error("Failed to save memory.json:", err.message);
    }
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      }
    } catch (err) {
      logger.error("Failed to load state.json:", err.message);
    }
    return { positions: {}, recentEpisodes: [], lastUpdated: null };
  }

  saveState() {
    try {
      this.state.lastUpdated = new Date().toISOString();
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    } catch (err) {
      logger.error("Failed to save state.json:", err.message);
    }
  }

  loadMemory() {
    try {
      if (fs.existsSync(MEMORY_FILE)) {
        return JSON.parse(fs.readFileSync(MEMORY_FILE, "utf8"));
      }
    } catch (err) {
      logger.error("Failed to load memory.json:", err.message);
    }
    return {
      poolHistory: {},
      lessons: [],
      signals: [],
      statistics: {
        totalDeployed: 0,
        totalClosed: 0,
        totalPnl: 0,
        bestPool: null,
        worstPool: null,
      }
    };
  }

  saveMemory() {
    try {
      this.memory.lastUpdated = new Date().toISOString();
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(this.memory, null, 2));
    } catch (err) {
      logger.error("Failed to save memory.json:", err.message);
    }
  }

  // ─── Position Tracking ────────────────────────────────────────

  trackPosition(positionData) {
    const { position, pool, pool_name, strategy, amount_sol, active_bin, fee_tvl_ratio, volatility } = positionData;

    this.state.positions[position] = {
      position,
      pool,
      pool_name,
      strategy: strategy || "bid_ask",
      amount_sol,
      active_bin_at_deploy: active_bin,
      fee_tvl_ratio,
      volatility,
      deployed_at: new Date().toISOString(),
      out_of_range_since: null,
      last_claim_at: null,
      total_fees_claimed: 0,
      closed: false,
      closed_at: null,
      notes: [],
      peak_pnl_pct: 0,
      trailing_active: false,
    };

    // Update memory
    if (!this.memory.poolHistory[pool]) {
      this.memory.poolHistory[pool] = {
        deployments: 0,
        closes: 0,
        totalPnl: 0,
        avgPnl: 0,
        avgHoldMinutes: 0,
        lastVisit: null,
      };
    }
    this.memory.poolHistory[pool].deployments++;
    this.memory.poolHistory[pool].lastVisit = new Date().toISOString();
    this.memory.statistics.totalDeployed++;

    this.saveState();
    this.saveMemory();
    logger.info(`Tracked position ${position.slice(0, 8)} in pool ${pool_name || pool}`);
  }

  markOutOfRange(position, timestamp = new Date()) {
    const pos = this.state.positions[position];
    if (pos && !pos.out_of_range_since) {
      pos.out_of_range_since = timestamp.toISOString();
      this.saveState();
    }
  }

  markInRange(position) {
    const pos = this.state.positions[position];
    if (pos && pos.out_of_range_since) {
      pos.out_of_range_since = null;
      this.saveState();
    }
  }

  recordClaim(position, amountUsd) {
    const pos = this.state.positions[position];
    if (pos) {
      pos.total_fees_claimed += amountUsd;
      pos.last_claim_at = new Date().toISOString();
      this.saveState();
    }
  }

  markClosed(position, pnlUsd, pnlPct, reason) {
    const pos = this.state.positions[position];
    if (pos) {
      pos.closed = true;
      pos.closed_at = new Date().toISOString();
      pos.close_reason = reason;
      pos.final_pnl_usd = pnlUsd;
      pos.final_pnl_pct = pnlPct;

      // Update memory
      const pool = pos.pool;
      if (this.memory.poolHistory[pool]) {
        this.memory.poolHistory[pool].closes++;
        this.memory.poolHistory[pool].totalPnl += pnlPct;
        this.memory.poolHistory[pool].avgPnl = (this.memory.poolHistory[pool].totalPnl / this.memory.poolHistory[pool].closes);
      }

      this.memory.statistics.totalClosed++;
      this.memory.statistics.totalPnl += pnlPct;

      this.saveState();
      this.saveMemory();
    }
  }

  getPosition(position) {
    return this.state.positions[position] || null;
  }

  getOpenPositions() {
    return Object.values(this.state.positions).filter(p => !p.closed);
  }

  // ─── Episodes & Memory ───────────────────────────────────────

  async addEpisode(episode) {
    episode.id = `ep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    episode.timestamp = new Date().toISOString();
    this.state.recentEpisodes.unshift(episode);

    // Keep only last 100 episodes in memory (full data in DB)
    if (this.state.recentEpisodes.length > 100) {
      this.state.recentEpisodes = this.state.recentEpisodes.slice(0, 100);
    }

    this.saveState();
  }

  getRecentEpisodes(limit = 20) {
    return this.state.recentEpisodes.slice(0, limit);
  }

  recallForPool(pool) {
    const history = this.memory.poolHistory[pool];
    if (!history) return null;

    const winRate = history.closes > 0
      ? (history.closes.filter(c => c.pnl_pct > 0).length / history.closes).toFixed(2)
      : "N/A";

    return {
      deployments: history.deployments,
      closes: history.closes,
      avgPnl: history.avgPnl?.toFixed(2) || "N/A",
      winRate,
      lastVisit: history.lastVisit,
    };
  }

  setPositionInstruction(position, instruction) {
    const pos = this.state.positions[position];
    if (pos) {
      pos.instruction = instruction;
      this.saveState();
      return true;
    }
    return false;
  }

  getPositionInstruction(position) {
    return this.state.positions[position]?.instruction || null;
  }

  // ─── Pool Notes ───────────────────────────────────────────────

  addPoolNote(pool, note) {
    if (!this.memory.poolNotes) this.memory.poolNotes = {};
    if (!this.memory.poolNotes[pool]) this.memory.poolNotes[pool] = [];
    this.memory.poolNotes[pool].push({
      note,
      timestamp: new Date().toISOString(),
    });
    this.saveMemory();
  }

  getPoolNotes(pool) {
    return this.memory.poolNotes?.[pool] || [];
  }

  // ─── Pruning ─────────────────────────────────────────────────

  pruneOldEpisodes(retentionDays = 90) {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const before = this.state.recentEpisodes.length;
    this.state.recentEpisodes = this.state.recentEpisodes.filter(
      ep => new Date(ep.timestamp).getTime() > cutoff
    );
    const after = this.state.recentEpisodes.length;
    logger.info(`Pruned episodes: ${before - after} removed, ${after} kept`);
    this.saveState();
  }

  // Flush pending saves (call on shutdown)
  flushAll() {
    if (this.pendingState) this._flushState();
    if (this.pendingMemory) this._flushMemory();
  }
}

export { StateManager };
