import fetch from "node-fetch";
import { Config } from "../config/index.js";

const DATAPI_JUP = "https://datapi.jup.ag/v1";

export async function getTokenInfo({ query }) {
  try {
    // Jupiter token lookup
    const res = await fetch(`${DATAPI_JUP}/assets/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Jupiter API: ${res.status}`);

    const data = await res.json();
    const token = Array.isArray(data) ? data[0] : data;

    if (!token) return null;

    // Additional OKX enrichment
    const okxRes = await fetch(`https://www.okx.com/api/v5/markets/token?tokenId=${token.mint}`);
    const okxData = okxRes.ok ? await okxData.json() : null;

    return {
      mint: token.mint,
      symbol: token.symbol,
      name: token.name,
      decimals: token.decimals,
      supply: token.supply,
      market_cap: token.marketCap,
      holders: token.holders,
      launchpad: token.launchpadName,
      created_at: token.createdAt,
      signals: {
        smart_money_buy: okxData?.smart_money_buy || false,
        dev_sold_all: okxData?.dev_sold_all || false,
        rugpull_risk: okxData?.rugpull_risk || "low",
      },
      audit: {
        bot_holders_pct: token.botHoldersPct || 0,
        top_holders_pct: token.topHoldersPct || 0,
      },
    };
  } catch (err) {
    console.error("getTokenInfo failed:", err.message);
    return null;
  }
}

export async function getTokenHolders({ mint, limit = 20 }) {
  // Jupiter API: top holders
  try {
    const res = await fetch(`${DATAPI_JUP}/assets/holders?mint=${mint}&limit=${limit}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.holders || [];
  } catch (err) {
    console.error("getTokenHolders failed:", err.message);
    return [];
  }
}

export async function getTokenNarrative({ mint }) {
  // Simplified: would scrape DexScreener or similar
  return { narrative: "No narrative data available yet", sources: [] };
}
