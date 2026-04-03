/**
 * Tool Definitions — OpenAI function calling schemas
 *
 * Maps tool names to actual implementations found in other modules.
 */

export const tools = [
  // ═══════════════════════════════════════════
  //  SCREENING TOOLS
  // ═══════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_top_candidates",
      description: `Get the top pre-scored pool candidates ready for deployment.
All filtering and scoring already applied. Returns top N eligible pools ranked by score.
Each pool includes metrics and a computed score.`,
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of top candidates to return (default 3, max 20)",
            default: 3,
            minimum: 1,
            maximum: 20,
          },
        },
      },
    },
  },

  // ═══════════════════════════════════════════
  //  POSITION MANAGEMENT TOOLS
  // ═══════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_my_positions",
      description: "Fetch all open DLMM positions for the wallet. Includes PnL, fees, range status.",
      parameters: {
        type: "object",
        properties: {
          force: {
            type: "boolean",
            description: "Force fresh fetch from chain (skip cache)",
            default: false,
          },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_active_bin",
      description: "Get the current active bin and price for a DLMM pool.",
      parameters: {
        type: "object",
        properties: {
          pool_address: {
            type: "string",
            description: "The DLMM pool address (base58)",
          },
        },
        required: ["pool_address"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "deploy_position",
      description: `Open a new DLMM liquidity position.

IMPORTANT:
- Always call get_active_bin first to know current price.
- bins_below + bins_above = total bin range. Total bins > 69 requires special handling (handled internally).
- Strategy: "bid_ask" concentrates at range edges (bins_above MUST be 0). "spot" distributes evenly.
- Use amount_y for SOL (quote token), amount_x for base token (dual-sided deposits).

Learning hooks: pool metadata fields (bin_step, volatility, fee_tvl_ratio, organic_score, initial_value_usd)
are recorded and used for future threshold evolution. Provide them if available.`,
      parameters: {
        type: "object",
        properties: {
          pool_address: { type: "string", description: "Pool address" },
          amount_y: { type: "number", description: "Amount of quote token (SOL) to deposit" },
          amount_x: { type: "number", description: "Amount of base token to deposit (optional)" },
          strategy: { type: "string", enum: ["bid_ask", "spot"], description: "LP strategy" },
          bins_below: { type: "number", description: "Bins below active bin" },
          bins_above: { type: "number", description: "Bins above active bin (0 for bid_ask)" },
          pool_name: { type: "string", description: "Human-readable pool name (for records)" },
          bin_step: { type: "number", description: "Pool bin step (from discovery)" },
          volatility: { type: "number", description: "Pool volatility at deploy time" },
          fee_tvl_ratio: { type: "number", description: "fee/TVL ratio at deploy time" },
          organic_score: { type: "number", description: "Base token organic score" },
          initial_value_usd: { type: "number", description: "Estimated USD value deployed" },
        },
        required: ["pool_address", "amount_y", "strategy", "bins_below"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "close_position",
      description: "Close an open DLMM position. Automatically claims fees before closing.",
      parameters: {
        type: "object",
        properties: {
          position_address: {
            type: "string",
            description: "Position account address",
          },
          skip_swap: {
            type: "boolean",
            description: "If true, don't auto-swap remaining tokens to quote",
            default: false,
          },
        },
        required: ["position_address"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "claim_fees",
      description: "Claim unclaimed fees from a position without closing it.",
      parameters: {
        type: "object",
        properties: {
          position_address: {
            type: "string",
            description: "Position account address",
          },
        },
        required: ["position_address"],
      },
    },
  },

  // ═══════════════════════════════════════════
  //  WALLET & BALANCE TOOLS
  // ═══════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_wallet_balance",
      description: "Get wallet SOL balance and token balances via Helius.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },

  // ═══════════════════════════════════════════
  //  INTELLIGENCE TOOLS
  // ═══════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "check_smart_wallets",
      description: "Check if any smart money wallets are present in a pool. Smart money = high win rate + APR.",
      parameters: {
        type: "object",
        properties: {
          pool_address: {
            type: "string",
            description: "Pool address to check",
          },
        },
        required: ["pool_address"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_token_info",
      description: "Get token metadata including holders, market cap, age, narrative. Uses Jupiter+OKX data.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Token mint address or symbol",
          },
        },
        required: ["query"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "x_sentiment",
      description: "Analyze Twitter/X sentiment and mentions for a token symbol.",
      parameters: {
        type: "object",
        properties: {
          token_symbol: {
            type: "string",
            description: "Token symbol (e.g., BONK, WIF)",
          },
        },
        required: ["token_symbol"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "discord_signals",
      description: "Fetch recent token mentions from configured Discord channels.",
      parameters: {
        type: "object",
        properties: {
          hours_back: {
            type: "number",
            description: "How many hours to look back (default 6)",
            default: 6,
          },
        },
      },
    },
  },

  // ═══════════════════════════════════════════
  //  MEMORY & LEARNING TOOLS
  // ═══════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "get_episodes",
      description: "Retrieve recent trading episodes (deploy→close cycles) for analysis.",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Number of episodes to return (default 20)",
            default: 20,
          },
          regime: {
            type: "string",
            description: "Filter by market regime (bull, bear, sideways)",
          },
        },
      },
    },
  },

  {
    type: "function",
    function: {
      name: "add_lesson",
      description: "Add a new learned lesson to be injected into future prompts.",
      parameters: {
        type: "object",
        properties: {
          rule: {
            type: "string",
            description: "The lesson as a concise rule",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Topic tags (e.g., ['volatility', 'range'])",
          },
        },
        required: ["rule"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "evolve_thresholds",
      description: "Trigger threshold evolution based on performance data. Requires 10+ closed positions.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },

  // ═══════════════════════════════════════════
  //  CONFIG TOOLS
  // ═══════════════════════════════════════════
  {
    type: "function",
    function: {
      name: "update_config",
      description: "Update configuration parameters at runtime.",
      parameters: {
        type: "object",
        properties: {
          changes: {
            type: "object",
            description: "Flat object with key-value pairs to update",
            additionalProperties: { type: "string" },
          },
        },
        required: ["changes"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "get_pool_memory",
      description: "Get historical performance data for a specific pool.",
      parameters: {
        type: "object",
        properties: {
          pool: {
            type: "string",
            description: "Pool address",
          },
        },
        required: ["pool"],
      },
    },
  },

  {
    type: "function",
    function: {
      name: "add_pool_note",
      description: "Add a human note about a pool for future reference.",
      parameters: {
        type: "object",
        properties: {
          pool: {
            type: "string",
            description: "Pool address",
          },
          note: {
            type: "string",
            description: "Note text",
          },
        },
        required: ["pool", "note"],
      },
    },
  },
];
