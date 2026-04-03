/**
 * X/Twitter Intelligence Module
 *
 * Fetches token mentions, analyzes sentiment, tracks influential accounts.
 */
import fetch from "node-fetch";
import { Config } from "../config/index.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("X-INTEL");

export default class XSignals {
  constructor() {
    this.bearerToken = Config.load().intelligence.sources.x.bearerToken;
    this.trackedAccounts = Config.load().intelligence.sources.x.trackedAccounts;
    this.baseUrl = "https://api.twitter.com/2";
  }

  async fetch() {
    if (!this.bearerToken) {
      logger.warn("Twitter bearer token not configured");
      return [];
    }

    const signals = [];
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    try {
      // Search recent tweets mentioning tokens from tracked accounts
      for (const account of this.trackedAccounts) {
        const res = await fetch(
          `${this.baseUrl}/users/${account}/tweets?max_results=100&tweet.fields=created_at,public_metrics`,
          {
            headers: { Authorization: `Bearer ${this.bearerToken}` },
          }
        );

        if (!res.ok) {
          logger.error(`Twitter API error: ${res.status}`);
          continue;
        }

        const data = await res.json();
        const tweets = data.data || [];

        for (const tweet of tweets) {
          // Extract potential token symbols ($NAME or NAME)
          const tokenMatches = tweet.text.match(/\$([A-Za-z0-9]+)|(?<!\w)([A-Za-z]{2,10})(?!\w)/g);
          if (!tokenMatches) continue;

          const sentiment = this.analyzeSentiment(tweet.text);
          const influence = this.scoreInfluence(tweet);

          for (const raw of tokenMatches) {
            const symbol = raw.replace("$", "").toUpperCase();
            signals.push({
              token_symbol: symbol,
              source: "x",
              signal_type: "mention",
              confidence: (sentiment.bullish ? 0.7 : sentiment.bearish ? 0.3 : 0.5) * influence,
              data: {
                tweet_id: tweet.id,
                author: account,
                text: tweet.text,
                retweets: tweet.public_metrics?.retweet_count || 0,
                likes: tweet.public_metrics?.like_count || 0,
                created_at: tweet.created_at,
                sentiment,
              },
              timestamp: now,
            });
          }
        }

        await new Promise(r => setTimeout(r, 2000)); // rate limit
      }
    } catch (err) {
      logger.error("Twitter fetch failed:", err.message);
    }

    return signals;
  }

  async analyzeToken(tokenSymbol) {
    // Aggregate recent signals for a token
    const all = await this.fetch();
    const tokenSignals = all.filter(s => s.token_symbol === tokenSymbol);

    if (tokenSignals.length === 0) {
      return { token: tokenSymbol, score: 0, mentions: 0, bullish: 0 };

      const bullish = tokenSignals.filter(s => s.data.sentiment.bullish).length;
      const total = tokenSignals.length;
      const avgConfidence = tokenSignals.reduce((sum, s) => sum + s.confidence, 0) / total;
      const velocity = tokenSignals.filter(s => (Date.now() - s.timestamp) < 3600000).length; // last hour

      return {
        token: tokenSymbol,
        score: avgConfidence,
        mentions: total,
        bullish,
        velocity,
        lastUpdated: Date.now(),
      };
    }

    analyzeSentiment(text) {
      const bullishWords = ["bull", "moon", "gem", "pump", "buy", "long", "accumulate", "alpha", "narrative"];
      const bearishWords = ["rug", "scam", "dump", "sell", "short", "avoid", "honeypot", "dead"];

      const lower = text.toLowerCase();
      const bullish = bullishWords.some(w => lower.includes(w));
      const bearish = bearishWords.some(w => lower.includes(w));

      if (bullish && !bearish) return { bullish: true, bearish: false, score: 0.7 };
      if (bearish && !bullish) return { bullish: false, bearish: true, score: 0.3 };
      return { bullish: false, bearish: false, score: 0.5 };
    }

    scoreInfluence(tweet) {
      // Simple influence based on retweets + likes
      const metrics = tweet.public_metrics || {};
      const engagement = (metrics.retweet_count || 0) + (metrics.like_count || 0);
      if (engagement > 1000) return 1.2;
      if (engagement > 100) return 1.1;
      if (engagement > 10) return 1.0;
      return 0.9;
    }
  }
}
