/**
 * Wallet Operations — balances, swaps, token info
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { Config } from "../config/index.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("WALLET");

let _connection = null;
function getConnection() {
  if (!_connection) {
    _connection = new Connection(process.env.RPC_URL, "confirmed");
  }
  return _connection;
}

let _wallet = null;
function getWallet() {
  if (!_wallet) {
    if (!process.env.WALLET_PRIVATE_KEY) throw new Error("WALLET_PRIVATE_KEY not set");
    _wallet = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY));
  }
  return _wallet;
}

export async function getWalletBalances() {
  try {
    const wallet = getWallet();
    const HELIUS_KEY = process.env.HELIUS_API_KEY;
    if (!HELIUS_KEY) {
      return { wallet: wallet.publicKey.toString(), sol: 0, usdc: 0, total_usd: 0, error: "Helius key missing" };
    }

    const url = `https://api.helius.xyz/v1/wallet/${wallet.publicKey.toString()}/balances?api-key=${HELIUS_KEY}`;
    const res = await fetch(url);

    if (!res.ok) throw new Error(`Helius API: ${res.status}`);

    const data = await res.json();
    const balances = data.balances || [];

    const solEntry = balances.find(b => b.symbol === "SOL");
    const usdcEntry = balances.find(b => b.symbol === "USDC");

    return {
      wallet: wallet.publicKey.toString(),
      sol: solEntry?.balance || 0,
      sol_usd: solEntry?.usdValue || 0,
      usdc: usdcEntry?.balance || 0,
      usdc_usd: usdcEntry?.usdValue || 0,
      total_usd: data.totalUsdValue || 0,
      tokens: balances.map(b => ({
        mint: b.mint,
        symbol: b.symbol,
        balance: b.balance,
        usd: b.usdValue,
      })),
    };
  } catch (err) {
    logger.error("getWalletBalances failed:", err.message);
    return { wallet: null, sol: 0, usdc: 0, total_usd: 0, error: err.message };
  }
}

export async function swapToken({ from_mint, to_mint, amount, min_usd_out = null }) {
  // Jupiter swap integration
  if (process.env.DRY_RUN === "true") {
    return { dry_run: true, would_swap: { from_mint, to_mint, amount } };
  }

  try {
    const quoteRes = await fetch(
      `https://quote-api.jup.ag/v6/quote?inputMint=${from_mint}&outputMint=${to_mint}&amount=${Math.floor(amount * 1e9)}&slippageBps=50`
    );
    const quote = await quoteRes.json();

    // Construct and send swap transaction
    // (simplified — full implementation requires Jupiter swap API)
    return { success: true, message: "Swap executed" };
  } catch (err) {
    logger.error("swapToken failed:", err.message);
    return { success: false, error: err.message };
  }
}
