/**
 * Pool Discovery — Fetch from Meteora Pool Discovery API
 */
import fetch from "node-fetch";
import { Config } from "../config/index.js";

const POOL_DISCOVERY_BASE = "https://pool-discovery-api.datapi.meteora.ag";

export async function discoverPools({ page_size = 50, timeframe = "5m", category = "trending" } = {}) {
  const config = Config.load();

  const filters = [
    "base_token_has_critical_warnings=false",
    "quote_token_has_critical_warnings=false",
    "base_token_has_high_single_ownership=false",
    "pool_type=dlmm",
    `base_token_market_cap>=${config.screening.minMcap}`,
    `base_token_market_cap<=${config.screening.maxMcap}`,
    `base_token_holders>=${config.screening.minHolders}`,
    `volume>=${config.screening.minVolume}`,
    `tvl>=${config.screening.minTvl}`,
    `tvl<=${config.screening.maxTvl}`,
    `dlmm_bin_step>=${config.screening.minBinStep}`,
    `dlmm_bin_step<=${config.screening.maxBinStep}`,
    `fee_active_tvl_ratio>=${config.screening.minFeeActiveTvlRatio}`,
    `base_token_organic_score>=${config.screening.minOrganic}`,
    "quote_token_organic_score>=60",
  ].filter(Boolean).join("&&");

  const url = `${POOL_DISCOVERY_BASE}/pools?` +
    `page_size=${page_size}` +
    `&filter_by=${encodeURIComponent(filters)}` +
    `&timeframe=${timeframe}` +
    `&category=${category}`;

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Pool Discovery API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return {
    total: data.total,
    pools: data.data || [],
  };
}
