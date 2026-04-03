import fetch from "node-fetch";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
let CHAT_ID = process.env.TELEGRAM_CHAT_ID; // can be set on first message

export async function sendMessage(text) {
  if (!BOT_TOKEN) return;

  try {
    // If we don't have CHAT_ID yet, send to admin (from env or first message)
    const target = CHAT_ID || process.env.TELEGRAM_ADMIN_ID;

    const res = await fetch(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: target,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      }
    );

    const data = await res.json();
    if (data.ok && !CHAT_ID) {
      // Auto-capture chat_id from response
      CHAT_ID = data.result.chat.id;
      console.log(`[Telegram] Registered chat_id: ${CHAT_ID}`);
    }
  } catch (err) {
    console.error("Telegram send failed:", err.message);
  }
}

export async function sendHTML(html) {
  // Telegram supports limited HTML formatting
  await sendMessage(html); // fallback
}

export async function notifyDeploy(data) {
  const msg = `🚀 **Deployed**\n` +
    `Pool: ${data.pool_name}\n` +
    `Amount: ${data.amount_sol} SOL\n` +
    `Strategy: ${data.strategy}\n` +
    `Position: \`${data.position.slice(0, 8)}...\`` +
    (data.tx ? `\nTx: \`${data.tx.slice(0, 8)}...\`` : "");
  await sendMessage(msg);
}

export async function notifyClose(data) {
  const emoji = data.pnl_usd >= 0 ? "✅" : "❌";
  const msg = `${emoji} **Closed**\n` +
    `Position: \`${data.position.slice(0, 8)}...\`\n` +
    `PnL: ${data.pnl_usd >= 0 ? "+" : ""}$${data.pnl_usd.toFixed(2)}\n` +
    `Reason: ${data.reason}`;
  await sendMessage(msg);
}

export function isEnabled() {
  return !!BOT_TOKEN;
}
