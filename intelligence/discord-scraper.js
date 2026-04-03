/**
 * Discord Intelligence Module
 *
 * Monitors configured channels for token calls and alpha signals.
 * Uses Discord selfbot — use responsibly.
 */
import { Client, GatewayIntentBits } from "discord.js";
import { Config } from "../config/index.js";
import { Logger } from "../utils/logger.js";

const logger = new Logger("DISCORD-INTEL");

export default class DiscordScraper {
  constructor() {
    this.client = null;
    this.token = Config.load().intelligence.sources.discord.userToken;
    this.channelIds = Config.load().intelligence.sources.discord.channelIds;
  }

  async fetch() {
    if (!this.token) return [];

    if (!this.client) {
      this.client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
      });
    }

    const signals = [];
    const now = Date.now();

    try {
      // Quick connection to fetch recent messages
      await this.client.login(this.token);

      for (const channelId of this.channelIds) {
        const channel = await this.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) continue;

        const messages = await channel.messages.fetch({ limit: 100 });

        for (const msg of messages.values()) {
          // Only consider messages from last 6 hours
          const msgAge = now - msg.createdTimestamp;
          if (msgAge > 6 * 60 * 60 * 1000) continue;

          // Look for token symbols
          const tokens = this.extractTokens(msg.content);
          if (tokens.length === 0 && !msg.embeds.length) continue;

          // Check for signal strength indicators
          const strength = this.assessSignalStrength(msg);

          for (const token of tokens) {
            signals.push({
              token_symbol: token,
              source: "discord",
              signal_type: "channel_mention",
              confidence: strength,
              data: {
                channel_id: channelId,
                channel_name: channel.name,
                author: msg.author?.username,
                content: msg.content.slice(0, 200),
                timestamp: msg.createdTimestamp,
                message_id: msg.id,
              },
              timestamp: now,
            });
          }
        }
      }

      await this.client.destroy();
    } catch (err) {
      logger.error("Discord fetch failed:", err.message);
      if (this.client) await this.client.destroy().catch(() => { });
    }

    return signals;
  }

  extractTokens(content) {
    const tokens = [];
    // Match $SYMBOL or bare SYMBOL in typical token call format
    const match = content.match(/\$([A-Za-z0-9]{2,10})|(?<!\w)([A-Za-z]{2,10})(?!\w)/g);
    if (match) {
      for (const m of match) {
        const clean = m.replace("$", "").toUpperCase();
        if (clean.length >= 2 && !this.isCommonWord(clean)) {
          tokens.push(clean);
        }
      }
    }

    // Check for embed links with token addresses
    // (would need additional parsing for mint addresses)
    return [...new Set(tokens)]; // dedup
  }

  isCommonWord(word) {
    const common = new Set(["THE", "AND", "FOR", "YOU", "NOT", "ARE", "BUT", "HAS", "HAD", "WAS", "ALL", "ANY", "CAN", "HAS", "HAD", "HOW", "LET", "MAY", "NEW", "NOW", "OLD", "SEE", "TWO", "WHO", "WHY", "WITH", "THIS", "THAT", "FROM"]);
    return common.has(word) || /^\d+$/.test(word);
  }

  assessSignalStrength(message) {
    let score = 0.5; // baseline

    // Reactions
    const reactions = message.reactions.cache
      ? Array.from(message.reactions.cache.values()).reduce((sum, r) => sum + r.count, 0)
      : 0;
    score += Math.min(reactions * 0.05, 0.3);

    // Author credibility (simplified)
    const author = message.author?.username?.toLowerCase();
    if (author && (author.includes("alpha") || author.includes("call") || author.includes("gem")) {
      score += 0.1;
    }

    // Message features
    const content = message.content.toLowerCase();
    if (content.includes("mega") || content.includes("100x") || content.includes("alpha")) score += 0.1;
    if (content.includes("rug") || content.includes("scam")) score -= 0.3;

    return Math.max(0, Math.min(1, score));
  }
}
