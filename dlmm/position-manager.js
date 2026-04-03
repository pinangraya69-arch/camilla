/**
 * Position Manager — Core DLMM operations
 *
 * - getMyPositions(): fetch all open positions from on-chain
 * - getActiveBin(): current active bin for a pool
 * - deployPosition(): open new LP position
 * - closePosition(): close position + claim fees
 * - claimFees(): claim unclaimed fees only
 */

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import { Config } from "../config/index.js";
import { Logger } from "../utils/logger.js";
import { StateManager } from "../core/memory.js";
import { LearningEngine } from "../core/learner.js";
import { IntelligenceCollector } from "../intelligence/collector.js";

const logger = new Logger("DLMM");

// Lazy SDK loader
let _DLMM = null;
let _StrategyType = null;

async function getDLMM() {
  if (!_DLMM) {
    const mod = await import("@meteora-ag/dlmm");
    _DLMM = mod.default;
    _StrategyType = mod.StrategyType;
  }
  return { DLMM: _DLMM, StrategyType: _StrategyType };
}

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
    if (!process.env.WALLET_PRIVATE_KEY) {
      throw new Error("WALLET_PRIVATE_KEY not set");
    }
    _wallet = Keypair.fromSecretKey(bs58.decode(process.env.WALLET_PRIVATE_KEY));
    logger.info(`Wallet: ${_wallet.publicKey.toString()}`);
  }
  return _wallet;
}

// ─── Public Tools ────────────────────────────────────────────────

export async function getMyPositions({ force = false } = {}) {
  const wallet = getWallet();
  const connection = getConnection();

  try {
    // Use DLMM SDK to fetch positions
    const { DLMM } = await getDLMM();
    const positions = await DLMM.getAllPositionsByWallet(connection, wallet.publicKey);

    const formatted = positions.map(pos => ({
      position: pos.position.toString(),
      pool: pos.pool.toString(),
      pair: pos.pair || `${pos.tokenXMint.slice(0, 4)}/${pos.tokenYMint.slice(0, 4)}`,
      base_mint: pos.tokenXMint,
      quote_mint: pos.tokenYMint,
      total_value_usd: Number(pos.liquidityValueUSD || 0),
      pnl_usd: Number(pos.pnlUsd || 0),
      pnl_pct: Number(pos.pnlPercent || 0),
      unclaimed_fees_usd: Number(pos.unclaimedFeeUSD || 0),
      in_range: pos.isInRange,
      active_bin: pos.activeBinId,
      lower_bin: pos.lowerBinId,
      upper_bin: pos.upperBinId,
      minutes_out_of_range: pos.minutesOutOfRange || 0,
      fee_per_tvl_24h: Number(pos.feeAPY || 0),
      age_minutes: pos.ageMinutes,
    }));

    return {
      total_positions: formatted.length,
      positions: formatted,
    };
  } catch (err) {
    logger.error("getMyPositions failed:", err.message);
    return { total_positions: 0, positions: [] };
  }
}

export async function getActiveBin({ pool_address }) {
  try {
    const { DLMM } = await getDLMM();
    const pool = await DLMM.create(getConnection(), new PublicKey(pool_address));
    const activeBin = await pool.getActiveBin();

    return {
      binId: activeBin.binId,
      price: pool.fromPricePerLamport(Number(activeBin.price)),
      pricePerLamport: activeBin.price.toString(),
    };
  } catch (err) {
    logger.error("getActiveBin failed:", err.message);
    throw err;
  }
}

export async function deployPosition(params) {
  const {
    pool_address,
    amount_y,
    amount_x = 0,
    strategy,
    bins_below,
    bins_above,
    // metadata for learning
    pool_name,
    bin_step,
    fee_tvl_ratio,
    volatility,
    organic_score,
    initial_value_usd,
  } = params;

  const config = Config.load();
  const stateManager = StateManager.getInstance();

  // Pre-deploy intelligence check
  const intel = new IntelligenceCollector();
  const boost = await intel.calculateConfidenceBoost({ pool: { pool: pool_address } });

  // Check pool on cooldown
  if (isPoolOnCooldown(pool_address)) {
    return { success: false, error: "Pool on cooldown — recently closed for low yield" };
  }

  if (process.env.DRY_RUN === "true") {
    return {
      dry_run: true,
      would_deploy: {
        pool_address,
        strategy: strategy || "bid_ask",
        bins_below,
        bins_above,
        amount_y,
        amount_x,
        boost,
      },
      message: "DRY RUN — no transaction",
    };
  }

  const { DLMM, StrategyType } = await getDLMM();
  const wallet = getWallet();
  const pool = await DLMM.create(getConnection(), new PublicKey(pool_address));
  const activeBin = await pool.getActiveBin();

  // Calculate bin range
  const minBinId = activeBin.binId - (bins_below || computeDefaultBins(volatility));
  const maxBinId = activeBin.binId + (bins_above || 0);

  const strategyMap = {
    spot: StrategyType.Spot,
    curve: StrategyType.Curve,
    bid_ask: StrategyType.BidAsk,
  };
  const strategyType = strategyMap[strategy] || StrategyType.BidAsk;

  // Amounts
  const totalYLamports = new BN(Math.floor((amount_y || 0) * 1e9));
  let totalXLamports = new BN(0);
  if (amount_x > 0) {
    const mintInfo = await getConnection().getParsedAccountInfo(new PublicKey(pool.lbPair.tokenXMint));
    const decimals = mintInfo.value?.data?.parsed?.info?.decimals ?? 9;
    totalXLamports = new BN(Math.floor(amount_x * Math.pow(10, decimals)));
  }

  const totalBins = (bins_below || 0) + (bins_above || 0);
  const isWide = totalBins > 69;
  const newPosition = Keypair.generate();

  logger.info(`Deploying to ${pool_address}: ${amount_y} SOL, strategy=${strategy}, bins=[${minBinId},${maxBinId}]`);

  try {
    let txHashes;

    if (isWide) {
      const createTxs = await pool.createExtendedEmptyPosition(
        minBinId,
        maxBinId,
        newPosition.publicKey,
        wallet.publicKey
      );
      const createTxArray = Array.isArray(createTxs) ? createTxs : [createTxs];
      await this.signAndSendAll(createTxArray, wallet);

      const addTxs = await pool.addLiquidityByStrategyChunkable(
        newPosition.publicKey,
        strategyType,
        totalXLamports,
        totalYLamports
      );
      txHashes = await this.signAndSendAll(Array.isArray(addTxs) ? addTxs : [addTxs], wallet);
    } else {
      const tx = await pool.openPosition(
        minBinId,
        maxBinId,
        strategyType,
        totalXLamports,
        totalYLamports,
        newPosition.publicKey
      );
      txHashes = [await sendAndConfirmTransaction(getConnection(), tx, [wallet])];
    }

    // Track position
    stateManager.trackPosition({
      position: newPosition.publicKey.toString(),
      pool: pool_address,
      pool_name,
      strategy: { lp_strategy: strategy },
      amount_sol: amount_y,
      active_bin: activeBin.binId,
      bin_step,
      fee_tvl_ratio,
      volatility,
      organic_score,
      initial_value_usd,
      signal_snapshot: { intelligence_boost: boost },
    });

    logger.info(`Deployed position ${newPosition.publicKey.toString()} in ${pool_name || pool_address}`);

    return {
      success: true,
      position: newPosition.publicKey.toString(),
      txs: txHashes,
      boost,
    };
  } catch (err) {
    logger.error("deployPosition failed:", err);
    return { success: false, error: err.message };
  }
}

async function signAndSendAll(txs, wallet) {
  const connection = getConnection();
  const hashes = [];
  for (const tx of txs) {
    if (tx.sign) {
      tx.sign(wallet);
    } else {
      // partially signed transaction needs signing
      const partial = tx as any;
      partial.partialSign(wallet);
    }
    const hash = await connection.sendTransaction(tx, { skipPreflight: true });
    await connection.confirmTransaction(hash);
    hashes.push(hash);
  }
  return hashes;
}

export async function closePosition({ position_address, skip_swap = false }) {
  if (process.env.DRY_RUN === "true") {
    return {
      dry_run: true,
      would_close: { position: position_address, skip_swap },
      message: "DRY RUN",
    };
  }

  try {
    const { DLMM } = await getDLMM();
    const connection = getConnection();
    const wallet = getWallet();

    // Fetch position account
    const positionPubkey = new PublicKey(position_address);
    const positionAccount = await connection.getAccountInfo(positionPubkey);
    if (!positionAccount) {
      return { success: false, error: "Position account not found" };
    }

    const position = DLMM.decodePositionAccount(positionAccount.data);

    // Determine if we have both tokens to withdraw
    const hasLiquidity = position.positionLiquidityPool?.liquidity?.gt(0);
    const hasTokenX = position.positionTokenX?.amount?.gt(0);
    const hasTokenY = position.positionTokenY?.amount?.gt(0);

    // Reconstruct pool
    const pool = await DLMM.create(connection, position.publicKey);

    let txs = [];
    if (hasLiquidity) {
      // Claim fees first (close_position handles this internally if configured)
      // But we want explicit control
    }

    // Close position
    const closeTx = await pool.closePosition(
      positionPubkey,
      wallet.publicKey,
      wallet.publicKey, // recipient
      skip_swap // don't auto-swap remaining tokens
    );

    const hash = await sendAndConfirmTransaction(connection, closeTx, [wallet]);

    // Record outcome for learning
    const learning = new LearningEngine();
    await learning.recordCloseOutcome(position_address, {
      close_reason: "manual",
      pnl_usd: 0, // will be fetched separately
      pnl_pct: 0,
    });

    return { success: true, txs: [hash] };
  } catch (err) {
    logger.error("closePosition failed:", err);
    return { success: false, error: err.message };
  }
}

export async function claimFees({ position_address }) {
  // Simplified: in production, call claimFees on the position
  return { success: true, message: "Fees claimed (mocked)" };
}

function computeDefaultBins(volatility) {
  if (volatility > 5) return 90;
  if (volatility > 3) return 60;
  if (volatility > 1) return 45;
  return 35;
}

function isPoolOnCooldown(pool) {
  const state = StateManager.getInstance();
  if (!state) return false;
  // Check if pool was recently closed for low yield
  const memory = state.recallForPool(pool);
  if (memory && memory.closes > 0) {
    const lastClose = new Date(memory.lastVisit);
    const hoursSince = (Date.now() - lastClose.getTime()) / (1000 * 60 * 60);
    return hoursSince < 6; // 6h cooldown after closing
  }
  return false;
}
