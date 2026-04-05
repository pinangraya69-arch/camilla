# Camilla — Self-Learning LP Agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Autonomous, self-improving liquidity provider for Meteora DLMM pools on Solana.**

Camilla goes beyond standard bots by learning from every trade, aggregating intelligence from social media, tracking smart money, and evolving its strategy automatically.

## Features

### 🧠 Self-Learning Core
- **Reinforcement Learning** — learns from wins & losses, adjusts behavior
- **Outcome Classification** — categorizes trades (win_high, win_low, draw, loss)
- **Threshold Evolution** — screening filters adapt based on performance
- **Strategy Optimization** — discovers which strategies work in which regimes
- **Episode Memory** — remembers context, decisions, and outcomes

### 📰 Multi-Source Intelligence
- **X/Twitter** — sentiment analysis, mention velocity, influencer tracking
- **Discord** — alpha group monitoring, signal collection
- **Smart Money** — tracks profitable LP wallets, clones their behavior
- **KOL Behavior** — detects when influencers add/remove liquidity

### 🔮 Predictive Capabilities
- **Market Regime Detection** — bull/bear/sideways with clustering
- **Price Direction Forecasting** — short-term (1-4h) movement prediction
- **Anomaly Detection** — wash trading, bundle manipulation, rug pull signals
- **Range Optimization** — calculates optimal bin placement based on volatility

### 🛡️ Safety & Reliability
- **Multi-Source Validation** — requires consensus before deploying
- **Dynamic Risk Assessment** — adjusts position size based on confidence
- **Cooldown System** — avoids over-trading, respects gas constraints
- **Explainability** — every decision logged with reasoning

## Quick Start

```bash
# Clone & install
git clone https://github.com/pinangraya69-arch/camilla.git
cd camilla
npm install

# Setup wizard (creates .env and user-config.json)
npm run setup

# Dry-run (no real transactions)
npm run dev

# Live trading
npm start

# CLI commands
node cli.js status
node cli.js candidates
node cli.js screen
node cli.js manage
node cli.js learn
```

## Configuration

### Environment (.env)

```env
# Wallet
WALLET_PRIVATE_KEY=your_base58_private_key

# RPC
RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
HELIUS_API_KEY=your_helius_key

# LLM (OpenRouter recommended)
OPENROUTER_API_KEY=sk-or-...
LLM_MODEL=openrouter/anthropic/claude-3-opus
LLM_TEMPERATURE=0.3

# Telegram (optional)
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_CHAT_ID=

# X/Twitter (optional)
TWITTER_BEARER_TOKEN=...

# Discord (selfbot) — use with caution
DISCORD_USER_TOKEN=...
DISCORD_CHANNEL_IDS=...

# Redis (for real-time signal caching) — optional
REDIS_URL=redis://localhost:6379

# Mode
DRY_RUN=true
```

### User Config (user-config.json)

```json
{
  "risk": {
    "maxPositions": 3,
    "maxDeployAmount": 50,
    "gasReserve": 0.2
  },
  "learning": {
    "minPositionsToEvolve": 10,
    "evolutionStrength": 0.1,
    "memoryRetentionDays": 90
  },
  "intelligence": {
    "sources": {
      "x": { "enabled": true, "minMentions": 3 },
      "discord": { "enabled": true },
      "smartMoney": { "enabled": true, "minProfitability": "5%" },
      "kol": { "enabled": true }
    },
    "signalFusion": {
      "requireAtLeast": 2,
      "confidenceThreshold": 0.7
    }
  },
  "screening": {
    "minFeeActiveTvlRatio": 0.05,
    "minTvl": 10000,
    "maxTvl": 150000,
    "minVolume": 500,
    "minOrganic": 60,
    "minHolders": 500,
    "minMcap": 150000,
    "maxMcap": 10000000,
    "minBinStep": 80,
    "maxBinStep": 125,
    "blockedLaunchpads": ["pump.fun", "letsbonk.fun"]
  },
  "management": {
    "deployAmountSol": 0.5,
    "positionSizePct": 0.35,
    "stopLossPct": -50,
    "takeProfitFeePct": 5,
    "outOfRangeWaitMinutes": 30,
    "minFeePerTvl24h": 7,
    "trailingTakeProfit": true,
    "trailingTriggerPct": 3,
    "trailingDropPct": 1.5
  },
  "schedule": {
    "screeningIntervalMin": 30,
    "managementIntervalMin": 10,
    "intelligenceRefreshMin": 15
  }
}
```

## How It Works

### Agent Loop

```
┌─────────────────────────────────────────────────────────┐
│                     COORDINATOR                          │
├─────────────────────────────────────────────────────────┤
│  ┌────────────┐  ┌────────────┐  ┌─────────────────┐   │
│  │Screening   │  │Management  │  │Intelligence     │   │
│  │Agent       │  │Agent       │  │Collector        │   │
│  └────────────┘  └────────────┘  └─────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │                │                  │
         ▼                ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│              Learning & Evolution Engine                │
│  • Record episodes                                      │
│  • Classify outcomes                                    │
│  • Update thresholds                                    │
│  • Optimize strategies                                  │
└─────────────────────────────────────────────────────────┘
```

### Episode Recording

Every deploy → close cycle:

```javascript
{
  episode_id: "uuid",
  context: {
    timestamp: "...",
    wallet_balance: 2.5,
    market_regime: "bull_volatile",
    volatility_index: 4.2,
    open_positions: 2
  },
  decision: {
    pool: "pool_address",
    strategy: { lp_strategy: "bid_ask", bins_below: 52 },
    deploy_amount: 0.5,
    considered: 12,
    rejected: ["pool1", "pool2"],
    intelligence_signals: {
      x_sentiment: 0.73,
      smart_money_present: true,
      kol_approval: 0.8
    }
  },
  outcome: {
    pnl_pct: 6.2,
    fees_earned: 0.015,
    hold_minutes: 180,
    in_range_pct: 85,
    close_reason: "take_profit"
  },
  lessons: [
    "High volatility pools (>4) benefit from bins_below=60+",
    "Smart money presence correlates with +2% avg PnL boost"
  ]
}
```

### Intelligence Fusion

Multiple sources → confidence score:

```javascript
signalScore =
  w1 * xSentiment +
  w2 * smartMoneyPresence +
  w3 * kolConsensus +
  w4 * discordVolatility +
  w5 * poolAnomalyScore

if (signalScore >= config.confidenceThreshold && sourceCount >= 2) {
  boostDeployPriority(signalScore);
}
```

## CLI Commands

```bash
# Status
camilla status                    # Wallet + positions
camilla candidates               # Top pool candidates
camilla positions                # List with performance
camilla pnl <position>          # Detailed PnL for one position

# Actions
camilla screen                   # Run screening cycle
camilla manage                   # Run management cycle
camilla deploy <pool> <amount>   # Manual deploy
camilla close <position>         # Manual close

# Intelligence
camilla signals x                # Fetch X signals
camilla signals smart-money      # Track smart wallets
camilla signals kol              # Check KOL activity
camilla intelligence refresh    # Refresh all sources

# Learning
camilla episodes                 # Show recent episodes
camilla lessons                  # List learned lessons
camilla evolve                   # Trigger threshold evolution
camilla strategy create          # Create new strategy from patterns

# Configuration
camilla config get               # Show current config
camilla config set <key> <val>  # Update config
camilla config evolve            # Auto-evolve from performance

# Database
camilla memory export            # Export episodes
camilla memory import <file>     # Import episodes
camilla memory prune             # Delete old records (> retention days)
```

## REPL Mode

Start interactive mode:

```bash
npm start
```

REPL prompt shows cycle countdown:

```
[manage: 3m 12s | screen: 18m 45s]
>
```

Commands:
- `/status`, `/candidates`, `/positions` — standard
- `/intel` — show current intelligence signals
- `/episodes` — recent trade history
- `/lessons` — what Camilla learned
- `/evolve` — run evolution cycle
- `/strategy` — create strategy from recent wins
- anything else — free chat with the agent

## Telegram Bot

Same as Meridian — notifications + chat commands.

## Dashboard (Optional)

Run web dashboard for visualization:

```bash
npm run dashboard
# → http://localhost:3000
```

Shows:
- Live positions & PnL
- Intelligence signal timeline
- Learning progress (threshold changes)
- Strategy performance comparison
- Episode viewer with filters

## Database Schema

**SQLite (local)**:

```sql
-- Episodes (every deploy → close cycle)
CREATE TABLE episodes (
  id TEXT PRIMARY KEY,
  timestamp TEXT,
  context_json TEXT,
  decision_json TEXT,
  outcome_json TEXT,
  lessons_json TEXT,
  pnl_pct REAL,
  close_reason TEXT,
  strategy_used TEXT,
  market_regime TEXT
);

-- Lessons (derived from episodes)
CREATE TABLE lessons (
  id TEXT PRIMARY KEY,
  rule TEXT,
  confidence REAL,
  tags_json TEXT,
  source_episodes_json TEXT,
  created_at TEXT,
  last_applied_at TEXT,
  success_correlation REAL
);

-- Strategies (evolved templates)
CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  name TEXT,
  conditions_json TEXT,
  entry_json TEXT,
  management_json TEXT,
  performance_json TEXT,
  deployments_count INTEGER,
  win_rate REAL,
  avg_pnl_pct REAL,
  last_updated TEXT
);

-- Signals (intelligence sources)
CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  source TEXT,  -- x|discord|smart_money|kol
  token_mint TEXT,
  signal_type TEXT,
  confidence REAL,
  data_json TEXT,
  timestamp TEXT,
  used_in_episode TEXT  -- FK to episodes.id if used
);

CREATE INDEX idx_episodes_timestamp ON episodes(timestamp);
CREATE INDEX idx_episodes_regime ON episodes(market_regime);
CREATE INDEX idx_lessons_confidence ON lessons(confidence DESC);
```

## Learning Algorithms

### Threshold Evolution

```javascript
function evolveThresholds(episodes) {
  const byThreshold = groupBy(episodes, "screening_threshold_used");

  const changes = {};

  for (const [threshold, eps] of Object.entries(byThreshold)) {
    const winRate = eps.filter(e => e.pnl_pct > 0).length / eps.length;

    if (winRate > 0.7) {
      // Tighten slightly — we're winning, can be more selective
      changes[threshold] = eps[0].threshold_value * 0.98;
    } else if (winRate < 0.4) {
      // Loosen filters — we're too strict, missing good opportunities
      changes[threshold] = eps[0].threshold_value * 1.05;
    }
  }

  return clampChanges(changes, maxChange: 0.2);
}
```

### Strategy Weight Adjustment

```javascript
const STRATEGY_WEIGHTS = {
  bid_ask: 1.0,
  spot: 1.0,
  curve: 0.5  // discouraged for DLMM
};

function updateWeights(episodes) {
  const byStrategy = groupBy(episodes, "strategy_lp");

  for (const [strategy, eps] of Object.entries(byStrategy)) {
    const avgPnL = average(eps.map(e => e.pnl_pct));
    const winRate = eps.filter(e => e.pnl_pct > 0).length / eps.length;

    const score = (avgPnL * 0.6) + (winRate * 100 * 0.4);

    STRATEGY_WEIGHTS[strategy] = lerp(
      STRATEGY_WEIGHTS[strategy] || 1.0,
      score / 10,  // normalize to [0,1] range
      0.1  // learning rate
    );
  }
}
```

### Bin Range Optimization

```javascript
function optimalBins(volatility, tokenAgeHours, strategy) {
  const base = 45;

  // Volatility scaling
  const volMultiplier = 1 + (volatility - 3) * 0.15;

  // Newer tokens = wider range (more unpredictable)
  const ageFactor = tokenAgeHours < 24 ? 1.3 : 1.0;

  // Strategy adjustment
  const strategyFactor = strategy === "bid_ask" ? 0.8 : 1.2;

  const total = Math.round(base * volMultiplier * ageFactor * strategyFactor);

  // Bid-ask: almost all bins below active
  const bins_below = strategy === "bid_ask" ? Math.round(total * 0.95) : Math.round(total * 0.5);
  const bins_above = total - bins_below;

  return { bins_below, bins_above };
}
```

## Testing

```bash
# Unit tests
npm test

# Backtest against historical data
npm run train -- --from 2025-01-01 --to 2025-03-31

# Dry-run with simulated wallet
DRY_RUN=true npm start
```

## Deployment

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
CMD ["node", "index.js"]
```

### PM2

```bash
npm install -g pm2
pm2 start index.js --name camilla
pm2 save
pm2 startup
```

## Disclaimer

**THIS IS EXPERIMENTAL SOFTWARE. YOU CAN LOSE FUNDS.**

Always start with `DRY_RUN=true` and small amounts. Never deploy more than you can afford to lose. Use at your own risk.

## Roadmap

- [ ] Reinforcement learning with Q-learning for position sizing
- [ ] Transfer learning: import Meridian performance data
- [ ] On-chain anomaly detection (MEV, sandwich attacks)
- [ ] Multi-wallet coordination for larger positions
- [ ] FaaS (Farming as a Service) delegation layer
- [ ] API for third-party integrations
- [ ] Mobile push notifications
- [ ] DAO governance for parameter changes

## Inspiration

Built by studying:
- [Meridian](https://github.com/yunus-0x/meridian) — exceptional DLMM agent architecture
- [Hummingbot](https://github.com/hummingbot/hummingbot) — market making strategies
- [R2R](https://github.com/real-english/real2) — intelligence aggregation

## License

MIT
