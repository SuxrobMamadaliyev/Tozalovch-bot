const { Markup } = require('telegraf');
const db = require('./database');
const langs = require('./languages');

const ADMIN_IDS = process.env.ADMIN_IDS.split(',').map(Number);

const isAdmin = (id) => ADMIN_IDS.includes(id);

async function adminPanel(ctx) {
  const count = db.getUserCount();
  await ctx.reply(
    `🛠 *Admin Panel*\n\n👥 Jami foydalanuvchilar: *${count}*`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📨 Habar yuborish', 'admin_broadcast')],
        [Markup.button.callback('📊 Statistika', 'admin_stats')],
        [Markup.button.callback('👥 Foydalanuvchilar', 'admin_users')],
      ]),
    }
  );
}

async function broadcastMenu(ctx) {
  await ctx.answerCbQuery();
  await ctx.reply(
    '📨 *Habar yuborish*\n\nQuyidagi formatda yozing:\n\n```\n[til_kodi]\nMatn...\n---\n[til_kodi]\nMatn...\n```\n\nMisol:\n```\nuz\nSalom! Yangi yangilik!\n---\nen\nHello! New update!\n---\nru\nПривет! Новости!\n```\n\n_Agar faqat bitta til yozsangiz, hammaga o\'sha tilda jo\'natiladi._',
    { parse_mode: 'Markdown' }
  );
  ctx.session = ctx.session || {};
  ctx.session.adminStep = 'waiting_broadcast';
}

async function handleBroadcast(ctx, text) {
  // Matnni parse qilish
  const messages = {};
  const parts = text.split('---').map(s => s.trim()).filter(Boolean);

  if (parts.length === 1 && !parts[0].includes('\n')) {
    // Faqat text - hammaga bir xil
    for (const l of Object.keys(langs)) messages[l] = parts[0];
  } else if (parts.length === 1) {
    // Tili ko'rsatilmagan - hammaga bir xil
    for (const l of Object.keys(langs)) messages[l] = parts[0];
  } else {
    for (const part of parts) {
      const lines = part.split('\n');
      const langCode = lines[0].trim().toLowerCase();
      const msg = lines.slice(1).join('\n').trim();
      if (langs[langCode] && msg) {
        messages[langCode] = msg;
      }
    }
  }

  const users = db.getAllUsers();
  let sent = 0, failed = 0;

  await ctx.reply(`📤 Jo'natilmoqda... (${users.length} ta foydalanuvchi)`);

  for (const user of users) {
    const userLang = user.lang || 'en';
    // Foydalanuvchi tilidagi habar, yo'q bo'lsa inglizcha
    const msgText = messages[userLang] || messages['en'] || Object.values(messages)[0];
    if (!msgText) continue;

    try {
      await ctx.telegram.sendMessage(user.id, msgText, { parse_mode: 'Markdown' });
      sent++;
    } catch (e) {
      if (e.message.includes('blocked') || e.message.includes('deactivated')) {
        db.blockUser(user.id);
      }
      failed++;
    }
    await new Promise(r => setTimeout(r, 50)); // Rate limit
  }

  await ctx.reply(
    `✅ *Yuborildi!*\n\n✔️ Muvaffaqiyatli: ${sent}\n❌ Xato: ${failed}`,
    { parse_mode: 'Markdown' }
  );
}

module.exports = { isAdmin, adminPanel, broadcastMenu, handleBroadcast };
