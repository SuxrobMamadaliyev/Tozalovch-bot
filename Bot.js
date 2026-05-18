require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const UserSession = require('./userbot');

const bot = new Telegraf(process.env.BOT_TOKEN);
bot.use(session());

const userSessions = new Map();

bot.start(async (ctx) => {
  await ctx.reply(
    `👋 Salom! Men sizga Telegram'dagi keraksiz kanal, guruh va botlardan chiqishga yordam beraman.\n\n` +
    `📱 Boshlash uchun Telegram akkauntingizni ulang:`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔗 Akkauntni ulash', 'connect_account')],
    ])
  );
});

bot.action('connect_account', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `📞 Telefon raqamingizni kiriting (xalqaro formatda):\nMisol: +998901234567`
  );
  ctx.session = { step: 'waiting_phone' };
});

bot.on('text', async (ctx) => {
  const session = ctx.session || {};
  const userId = ctx.from.id;

  // --- Telefon raqam ---
  if (session.step === 'waiting_phone') {
    const phone = ctx.message.text.trim();
    ctx.session.phone = phone;

    let userbot = userSessions.get(userId);
    if (!userbot) {
      userbot = new UserSession(userId);
      userSessions.set(userId, userbot);
    }

    await ctx.reply('⏳ Kod yuborilmoqda...');
    try {
      await userbot.sendCode(phone);
      ctx.session.step = 'waiting_code';
      await ctx.reply('📩 Telegramdan kelgan tasdiqlash kodini kiriting:');
    } catch (err) {
      await ctx.reply(`❌ Xato: ${err.message}`);
    }
    return;
  }

  // --- Tasdiqlash kodi ---
  if (session.step === 'waiting_code') {
    const code = ctx.message.text.trim();
    const userbot = userSessions.get(userId);

    try {
      await userbot.signIn(session.phone, code);
      ctx.session.step = 'authorized';
      await ctx.reply(
        '✅ Akkaunt muvaffaqiyatli ulandi!\n\nNimani skanerlashni xohlaysiz?',
        Markup.inlineKeyboard([
          [Markup.button.callback('📢 Kanallar', 'scan_channels')],
          [Markup.button.callback('👥 Guruhlar', 'scan_groups')],
          [Markup.button.callback('🤖 Botlar', 'scan_bots')],
          [Markup.button.callback('🔍 Hammasini skaner qil', 'scan_all')],
        ])
      );
    } catch (err) {
      if (err.message.includes('2FA') || err.message.includes('password')) {
        ctx.session.step = 'waiting_2fa';
        await ctx.reply('🔐 2FA parolingizni kiriting:');
      } else {
        await ctx.reply(`❌ Xato: ${err.message}`);
      }
    }
    return;
  }

  // --- 2FA ---
  if (session.step === 'waiting_2fa') {
    const password = ctx.message.text.trim();
    const userbot = userSessions.get(userId);

    try {
      await userbot.checkPassword(password);
      ctx.session.step = 'authorized';
      await ctx.reply(
        '✅ Kirish muvaffaqiyatli!\n\nNimani skanerlashni xohlaysiz?',
        Markup.inlineKeyboard([
          [Markup.button.callback('📢 Kanallar', 'scan_channels')],
          [Markup.button.callback('👥 Guruhlar', 'scan_groups')],
          [Markup.button.callback('🤖 Botlar', 'scan_bots')],
          [Markup.button.callback('🔍 Hammasini skaner qil', 'scan_all')],
        ])
      );
    } catch (err) {
      await ctx.reply(`❌ Parol xato: ${err.message}`);
    }
    return;
  }
});

// --- Skanerlash ---
async function scanAndShow(ctx, type) {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const userbot = userSessions.get(userId);

  if (!userbot || !userbot.isAuthorized()) {
    return ctx.reply('❌ Avval akkauntingizni ulang!');
  }

  await ctx.reply('🔍 Skanerlash boshlandi...');

  try {
    const dialogs = await userbot.getDialogs(type);

    if (dialogs.length === 0) {
      return ctx.reply(`✅ ${type} topilmadi.`);
    }

    // Har bir dialog uchun tugma
    const buttons = dialogs.map((d) => [
      Markup.button.callback(
        `❌ ${d.title.substring(0, 30)}`,
        `leave_${d.id}`
      ),
    ]);

    buttons.push([Markup.button.callback('🗑 Hammasidan chiq', `leave_all_${type}`)]);
    buttons.push([Markup.button.callback('🔙 Ortga', 'back_menu')]);

    const typeEmoji = { channels: '📢', groups: '👥', bots: '🤖', all: '🔍' };
    await ctx.reply(
      `${typeEmoji[type] || '📋'} Topildi: ${dialogs.length} ta\n\nChiqmoqchi bo'lganlaringizni tanlang:`,
      Markup.inlineKeyboard(buttons)
    );

    // Session ga saqlash
    ctx.session.dialogs = dialogs;
    ctx.session.currentType = type;
  } catch (err) {
    await ctx.reply(`❌ Xato: ${err.message}`);
  }
}

bot.action('scan_channels', (ctx) => scanAndShow(ctx, 'channels'));
bot.action('scan_groups', (ctx) => scanAndShow(ctx, 'groups'));
bot.action('scan_bots', (ctx) => scanAndShow(ctx, 'bots'));
bot.action('scan_all', (ctx) => scanAndShow(ctx, 'all'));

// --- Chiqish ---
bot.action(/^leave_(\-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const dialogId = ctx.match[1];
  const userId = ctx.from.id;
  const userbot = userSessions.get(userId);

  try {
    const dialog = ctx.session?.dialogs?.find((d) => String(d.id) === dialogId);
    await userbot.leaveDialog(dialogId);
    await ctx.reply(`✅ "${dialog?.title || dialogId}" dan chiqildi!`);
  } catch (err) {
    await ctx.reply(`❌ Chiqib bo'lmadi: ${err.message}`);
  }
});

// --- Hammasidan chiqish ---
bot.action(/^leave_all_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id;
  const userbot = userSessions.get(userId);
  const dialogs = ctx.session?.dialogs || [];

  if (dialogs.length === 0) {
    return ctx.reply('❌ Chiqish uchun hech narsa yo\'q.');
  }

  await ctx.reply(`⏳ ${dialogs.length} ta dan chiqilmoqda...`);

  let success = 0;
  let failed = 0;

  for (const dialog of dialogs) {
    try {
      await userbot.leaveDialog(dialog.id);
      success++;
      await new Promise((r) => setTimeout(r, 1000)); // spam oldini olish
    } catch {
      failed++;
    }
  }

  await ctx.reply(
    `✅ Tugadi!\n✔️ Chiqildi: ${success}\n❌ Xato: ${failed}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('🔙 Menyu', 'back_menu')],
    ])
  );
});

bot.action('back_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    'Nimani skanerlashni xohlaysiz?',
    Markup.inlineKeyboard([
      [Markup.button.callback('📢 Kanallar', 'scan_channels')],
      [Markup.button.callback('👥 Guruhlar', 'scan_groups')],
      [Markup.button.callback('🤖 Botlar', 'scan_bots')],
      [Markup.button.callback('🔍 Hammasini skaner qil', 'scan_all')],
    ])
  );
});

bot.launch();
console.log('🤖 Bot ishga tushdi!');

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
