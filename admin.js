const { Markup } = require('telegraf');
const db = require('./database');
const langs = require('./languages');

// .env dan admin ID larni o'qish
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

const isAdmin = (id) => ADMIN_IDS.includes(id);

async function adminPanel(ctx) {
  if (!isAdmin(ctx.from.id)) {
    return ctx.reply('❌ Sizda admin huquqi yo\'q!');
  }
  const count = db.getUserCount();
  await ctx.reply(
    `🛠 *Admin Panel*\n\n👥 Jami foydalanuvchilar: *${count}*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📨 Habar yuborish', 'admin_broadcast')],
        [Markup.button.callback('📊 Statistika', 'admin_stats')],
        [Markup.button.callback('👥 Foydalanuvchilar ro\'yxati', 'admin_users')],
      ]),
    }
  );
}

async function broadcastMenu(ctx) {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    '📨 *Habar yuborish*\n\nMatn yozing (hammaga bir xil yuboriladi):\n\nYoki til bo\'yicha ajratish uchun:\n```\nuz\nO\'zbekcha matn\n---\nru\nRuscha matn\n---\nen\nEnglish text\n```',
    { parse_mode: 'Markdown' }
  );
  ctx.session = ctx.session || {};
  ctx.session.adminStep = 'waiting_broadcast';
}

async function handleBroadcast(ctx, text) {
  if (!isAdmin(ctx.from.id)) return;

  const messages = {};
  const parts = text
    .split('---')
    .map((s) => s.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    // Hammaga bir xil
    for (const l of Object.keys(langs)) {
      messages[l] = parts[0] || text;
    }
    messages['_default'] = parts[0] || text;
  } else {
    for (const part of parts) {
      const lines = part.split('\n');
      const langCode = lines[0].trim().toLowerCase();
      const msg = lines.slice(1).join('\n').trim();
      if (msg) {
        if (langs[langCode]) {
          messages[langCode] = msg;
        } else {
          messages['_default'] = part; // til kodi yo'q - default
        }
      }
    }
  }

  const users = db.getAllUsers();
  let sent = 0;
  let failed = 0;

  await ctx.reply(`📤 Yuborilmoqda... (${users.length} ta foydalanuvchi)`);

  for (const user of users) {
    const userLang = user.lang || 'uz';
    const msgText =
      messages[userLang] ||
      messages['uz'] ||
      messages['en'] ||
      messages['_default'] ||
      Object.values(messages)[0];

    if (!msgText) continue;

    try {
      await ctx.telegram.sendMessage(user.id, msgText, {
        parse_mode: 'Markdown',
      });
      sent++;
    } catch (e) {
      if (
        e.message.includes('blocked') ||
        e.message.includes('deactivated') ||
        e.message.includes('user not found')
      ) {
        db.blockUser(user.id);
      }
      failed++;
    }

    // Rate limit - Telegram 30 xabar/soniya cheklovi
    await new Promise((r) => setTimeout(r, 50));
  }

  await ctx.reply(
    `✅ *Yuborildi!*\n\n✔️ Muvaffaqiyatli: ${sent}\n❌ Xato: ${failed}`,
    { parse_mode: 'Markdown' }
  );
}

async function statsPanel(ctx) {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCbQuery().catch(() => {});
  const count = db.getUserCount();
  await ctx.reply(
    `📊 *Statistika*\n\n👥 Faol foydalanuvchilar: *${count}*`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { isAdmin, adminPanel, broadcastMenu, handleBroadcast, statsPanel };
