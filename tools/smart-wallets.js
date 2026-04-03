/**
 * Smart Wallets Analysis
 * Identifies and tracks high-performing LP wallets
 */
import fetch from "node-fetch";

const LPAGENT_API = "https://datapi.meteora.ag/v1";

export async function getTopLPers(limit = 50) {
  try {
    const res = await fetch(`${LPAGENT_API}/top-lpers?limit=${limit}`);
    if (!res.ok) throw new Error(`LPAgent API: ${res.status}`);
    const data = await res.json();
    return data.lpers || [];
  } catch (err) {
    console.error("getTopLPers failed:", err.message);
    return [];
  }
}

export async function studyTopLPers(poolAddress, limit = 10) {
  try {
    const res = await fetch(`${LPAGENT_API}/pool-lpers?pool=${poolAddress}&limit=${limit}`);
    if (!res.ok) throw new Error(`Pool LPAgent API: ${res.status}`);
    const data = await res.json();
    return data.lpers || [];
  } catch (err) {
    console.error("studyTopLPers failed:", err.message);
    return [];
  }
}

export function isSmartWallet(wallet, thresholds = { minWinRate: 0.6, minApr: 10, minPositions: 10 }) {
  return (
    wallet.win_rate >= thresholds.minWinRate &&
    wallet.avg_apr >= thresholds.minApr &&
    wallet.total_positions >= thresholds.minPositions
  );
}
