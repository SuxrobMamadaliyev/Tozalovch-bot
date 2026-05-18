require('dotenv').config();
const { Telegraf, Markup, session } = require('telegraf');
const UserSession = require('./userbot');
const db = require('./database');
const langs = require('./languages');
const {
  isAdmin,
  adminPanel,
  broadcastMenu,
  handleBroadcast,
  statsPanel,
} = require('./admin');

// ─── BOT YARATISH ────────────────────────────────────────────────────────────
const bot = new Telegraf(process.env.BOT_TOKEN);

// Session o'rnatish (xotirada)
bot.use(session({ defaultSession: () => ({}) }));

// Userbot sessiyalari xotirada (Map)
const userSessions = new Map();

// ─── YORDAMCHI FUNKSIYALAR ───────────────────────────────────────────────────

// Foydalanuvchi tilini olish
function getLang(ctx) {
  const id = ctx.from?.id;
  if (!id) return 'uz';
  return db.getLang(id) || ctx.session?.lang || 'uz';
}

// Tilga mos matn
function t(ctx, key) {
  const lang = getLang(ctx);
  return (langs[lang] && langs[lang][key]) || (langs['uz'] && langs['uz'][key]) || key;
}

// Kanal obuna tekshirish
async function checkSubscription(ctx) {
  const channelUsername = process.env.REQUIRED_CHANNEL;
  if (!channelUsername) return true; // Kanal belgilanmagan - o'tkazib yuboramiz

  try {
    const member = await ctx.telegram.getChatMember(
      channelUsername,
      ctx.from.id
    );
    return ['member', 'administrator', 'creator'].includes(member.status);
  } catch {
    return true; // Tekshirib bo'lmasa - ruxsat beramiz
  }
}

// Asosiy menyu (skanerlash)
function scanMenu(ctx) {
  const lang = getLang(ctx);
  const l = langs[lang] || langs['uz'];
  return Markup.inlineKeyboard([
    [Markup.button.callback(l.scan_channels || '📢 Kanallar', 'scan_channels')],
    [Markup.button.callback(l.scan_groups || '👥 Guruhlar', 'scan_groups')],
    [Markup.button.callback(l.scan_bots || '🤖 Botlar', 'scan_bots')],
    [Markup.button.callback(l.scan_all || '🔍 Hammasini skaner qil', 'scan_all')],
    [Markup.button.callback(l.disconnect || '🔌 Akkauntni uzish', 'disconnect')],
  ]);
}

// ─── /START ──────────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const userId = ctx.from.id;

  // Foydalanuvchini bazaga saqlash
  db.saveUser(
    userId,
    ctx.from.username,
    ctx.from.first_name,
    ctx.from.language_code === 'ru' ? 'ru' : 'uz'
  );

  // Obuna tekshirish
  const subscribed = await checkSubscription(ctx);
  if (!subscribed) {
    return ctx.reply(t(ctx, 'subscribe_required'), {
      ...Markup.inlineKeyboard([
        [Markup.button.url('📢 Kanal', process.env.REQUIRED_CHANNEL)],
        [Markup.button.callback(t(ctx, 'subscribed_btn') || '✅ Obuna bo\'ldim', 'check_sub')],
      ]),
    });
  }

  // Til tanlash
  await ctx.reply(t(ctx, 'choose_lang') || '🌐 Tilni tanlang:', {
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('🇺🇿 O\'zbek', 'lang_uz'),
        Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
        Markup.button.callback('🇬🇧 English', 'lang_en'),
      ],
    ]),
  });
});

// ─── OBUNA TEKSHIRISH ─────────────────────────────────────────────────────────
bot.action('check_sub', async (ctx) => {
  await ctx.answerCbQuery();
  const subscribed = await checkSubscription(ctx);
  if (subscribed) {
    await ctx.reply(t(ctx, 'choose_lang') || '🌐 Tilni tanlang:', {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🇺🇿 O\'zbek', 'lang_uz'),
          Markup.button.callback('🇷🇺 Русский', 'lang_ru'),
          Markup.button.callback('🇬🇧 English', 'lang_en'),
        ],
      ]),
    });
  } else {
    await ctx.answerCbQuery(t(ctx, 'not_subscribed') || '❌ Hali obuna bo\'lmadingiz!', {
      show_alert: true,
    });
  }
});

// ─── TIL TANLASH ─────────────────────────────────────────────────────────────
for (const langCode of ['uz', 'ru', 'en']) {
  bot.action(`lang_${langCode}`, async (ctx) => {
    await ctx.answerCbQuery();
    db.setLang(ctx.from.id, langCode);
    ctx.session.lang = langCode;

    const l = langs[langCode] || langs['uz'];
    await ctx.reply(l.welcome || `✅ Til tanlandi: ${langCode}`);

    // Admin bo'lsa - admin paneli ko'rsatish
    if (isAdmin(ctx.from.id)) {
      await adminPanel(ctx);
    }

    // Akkaunt ulash
    await ctx.reply(l.enter_phone || '📞 Telefon raqamingizni kiriting:', {
      ...Markup.inlineKeyboard([
        [Markup.button.callback(l.connect_account || '🔗 Akkauntni ulash', 'connect_account')],
      ]),
    });
  });
}

// ─── AKKAUNT ULASH ───────────────────────────────────────────────────────────
bot.action('connect_account', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.step = 'waiting_phone';
  await ctx.reply(t(ctx, 'enter_phone') || '📞 Telefon raqamingizni kiriting:\nMisol: +998901234567');
});

// ─── MATN HANDLER ────────────────────────────────────────────────────────────
bot.on('text', async (ctx) => {
  const sess = ctx.session || {};
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();

  // ── /admin buyrug'i ──
  if (text === '/admin') {
    if (isAdmin(userId)) {
      return adminPanel(ctx);
    }
    return ctx.reply('❌ Sizda admin huquqi yo\'q!');
  }

  // ── Admin broadcast matn kutish ──
  if (sess.adminStep === 'waiting_broadcast' && isAdmin(userId)) {
    ctx.session.adminStep = null;
    return handleBroadcast(ctx, text);
  }

  // ── Telefon raqam ──
  if (sess.step === 'waiting_phone') {
    const phone = text.replace(/\s+/g, '');

    // Telefon format tekshirish
    if (!/^\+\d{7,15}$/.test(phone)) {
      return ctx.reply('❌ Noto\'g\'ri format! Misol: +998901234567');
    }

    ctx.session.phone = phone;

    let userbot = userSessions.get(userId);
    if (!userbot) {
      userbot = new UserSession(userId);
      userSessions.set(userId, userbot);
    }

    await ctx.reply(t(ctx, 'sending_code') || '⏳ Kod yuborilmoqda...');
    try {
      await userbot.sendCode(phone);
      ctx.session.step = 'waiting_code';
      await ctx.reply(t(ctx, 'enter_code') || '📩 Telegramdan kelgan kodni kiriting:');
    } catch (err) {
      await ctx.reply(`❌ Xato: ${err.message}`);
    }
    return;
  }

  // ── Tasdiqlash kodi ──
  if (sess.step === 'waiting_code') {
    const code = text.replace(/\s+/g, '');
    const userbot = userSessions.get(userId);

    if (!userbot) {
      ctx.session.step = 'waiting_phone';
      return ctx.reply('❌ Session topilmadi. Telefon raqamingizni qayta kiriting:');
    }

    try {
      await userbot.signIn(sess.phone, code);
      ctx.session.step = 'authorized';
      await ctx.reply(
        t(ctx, 'connected') || '✅ Akkaunt ulandi! Nima skanerlash kerak?',
        scanMenu(ctx)
      );
    } catch (err) {
      if (
        err.message.toLowerCase().includes('2fa') ||
        err.message.toLowerCase().includes('password') ||
        err.message.includes('SESSION_PASSWORD_NEEDED')
      ) {
        ctx.session.step = 'waiting_2fa';
        await ctx.reply(t(ctx, 'enter_2fa') || '🔐 2FA parolingizni kiriting:');
      } else if (err.message.includes('PHONE_CODE_INVALID')) {
        await ctx.reply('❌ Kod noto\'g\'ri. Qayta kiriting:');
      } else if (err.message.includes('PHONE_CODE_EXPIRED')) {
        ctx.session.step = 'waiting_phone';
        await ctx.reply('❌ Kod eskirdi. Telefon raqamingizni qayta kiriting:');
      } else {
        await ctx.reply(`❌ Xato: ${err.message}`);
      }
    }
    return;
  }

  // ── 2FA paroli ──
  if (sess.step === 'waiting_2fa') {
    const password = text;
    const userbot = userSessions.get(userId);

    if (!userbot) {
      ctx.session.step = 'waiting_phone';
      return ctx.reply('❌ Session topilmadi. Telefon raqamingizni qayta kiriting:');
    }

    try {
      await userbot.checkPassword(password);
      ctx.session.step = 'authorized';
      await ctx.reply(
        t(ctx, 'connected') || '✅ Kirish muvaffaqiyatli! Nima skanerlash kerak?',
        scanMenu(ctx)
      );
    } catch (err) {
      await ctx.reply(`❌ Parol xato: ${err.message}`);
    }
    return;
  }
});

// ─── SKANERLASH ──────────────────────────────────────────────────────────────
async function scanAndShow(ctx, type) {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from.id;
  const userbot = userSessions.get(userId);

  if (!userbot || !userbot.isAuthorized()) {
    return ctx.reply(t(ctx, 'not_connected') || '❌ Avval akkauntingizni ulang!');
  }

  await ctx.reply(t(ctx, 'scanning') || '🔍 Skanerlash boshlandi...');

  try {
    const dialogs = await userbot.getDialogs(type);

    if (dialogs.length === 0) {
      return ctx.reply(t(ctx, 'nothing') || '✅ Hech narsa topilmadi.');
    }

    // Har bir dialog uchun tugma (dialog to'liq ma'lumoti bilan)
    const buttons = dialogs.map((d) => [
      Markup.button.callback(
        `❌ ${d.title.substring(0, 28)} (${d.type})`,
        `leave_${d.id}`
      ),
    ]);

    buttons.push([
      Markup.button.callback(
        t(ctx, 'leave_all') || '🗑 Hammasidan chiq',
        `leave_all_${type}`
      ),
    ]);
    buttons.push([
      Markup.button.callback(t(ctx, 'back') || '🔙 Ortga', 'back_menu'),
    ]);

    const typeEmoji = {
      channels: '📢',
      groups: '👥',
      bots: '🤖',
      all: '🔍',
    };

    await ctx.reply(
      `${typeEmoji[type] || '📋'} Topildi: ${dialogs.length} ta\n\nChiqmoqchi bo'lganlaringizni tanlang:`,
      Markup.inlineKeyboard(buttons)
    );

    // Session ga saqlash (id va entityClass birga)
    ctx.session.dialogs = dialogs;
    ctx.session.currentType = type;
  } catch (err) {
    console.error('scanAndShow error:', err);
    await ctx.reply(`❌ Xato: ${err.message}`);
  }
}

bot.action('scan_channels', (ctx) => scanAndShow(ctx, 'channels'));
bot.action('scan_groups', (ctx) => scanAndShow(ctx, 'groups'));
bot.action('scan_bots', (ctx) => scanAndShow(ctx, 'bots'));
bot.action('scan_all', (ctx) => scanAndShow(ctx, 'all'));

// ─── BITTA DAN CHIQISH ────────────────────────────────────────────────────────
bot.action(/^leave_(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const dialogId = ctx.match[1];
  const userId = ctx.from.id;
  const userbot = userSessions.get(userId);

  if (!userbot || !userbot.isAuthorized()) {
    return ctx.reply(t(ctx, 'not_connected') || '❌ Avval akkauntingizni ulang!');
  }

  // Session dagi dialogdan to'liq ma'lumotni olamiz
  const dialogInfo = ctx.session?.dialogs?.find((d) => d.id === dialogId);

  try {
    await userbot.leaveDialog(dialogInfo || dialogId);
    const title = dialogInfo?.title || dialogId;
    await ctx.reply(
      `✅ "${title}" ${t(ctx, 'left_msg') || 'dan chiqildi!'}`
    );
  } catch (err) {
    await ctx.reply(`❌ Chiqib bo'lmadi: ${err.message}`);
  }
});

// ─── HAMMASIDAN CHIQISH ───────────────────────────────────────────────────────
bot.action(/^leave_all_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from.id;
  const userbot = userSessions.get(userId);
  const dialogs = ctx.session?.dialogs || [];

  if (!userbot || !userbot.isAuthorized()) {
    return ctx.reply(t(ctx, 'not_connected') || '❌ Avval akkauntingizni ulang!');
  }

  if (dialogs.length === 0) {
    return ctx.reply('❌ Chiqish uchun hech narsa yo\'q.');
  }

  await ctx.reply(
    `${t(ctx, 'leaving_all') || '⏳ Chiqilmoqda...'} (${dialogs.length} ta)`
  );

  let success = 0;
  let failed = 0;

  for (const dialog of dialogs) {
    try {
      await userbot.leaveDialog(dialog);
      success++;
      // Spam himoyasi - har bir amal orasida 1.5 soniya kutish
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      console.error(`leaveDialog error for ${dialog.id}:`, err.message);
      failed++;
    }
  }

  await ctx.reply(
    `✅ ${t(ctx, 'done') || 'Tugadi!'}\n` +
      `✔️ ${t(ctx, 'left') || 'Chiqildi'}: ${success}\n` +
      `❌ ${t(ctx, 'failed') || 'Xato'}: ${failed}`,
    Markup.inlineKeyboard([
      [Markup.button.callback(t(ctx, 'back') || '🔙 Menyu', 'back_menu')],
    ])
  );

  // Session tozalash
  ctx.session.dialogs = [];
});

// ─── AKKAUNTNI UZISH ──────────────────────────────────────────────────────────
bot.action('disconnect', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  const userId = ctx.from.id;
  const userbot = userSessions.get(userId);

  if (userbot) {
    await userbot.disconnect();
    userSessions.delete(userId);
  }

  ctx.session.step = null;
  ctx.session.dialogs = [];

  await ctx.reply(
    t(ctx, 'disconnected') || '✅ Akkaunt uzildi.',
    Markup.inlineKeyboard([
      [Markup.button.callback(t(ctx, 'connect_account') || '🔗 Qayta ulash', 'connect_account')],
    ])
  );
});

// ─── ORTGA MENYU ──────────────────────────────────────────────────────────────
bot.action('back_menu', async (ctx) => {
  await ctx.answerCbQuery().catch(() => {});
  await ctx.reply(
    t(ctx, 'scan_all') || 'Nima skanerlashni xohlaysiz?',
    scanMenu(ctx)
  );
});

// ─── ADMIN PANELI ACTION LARI ─────────────────────────────────────────────────
bot.action('admin_broadcast', broadcastMenu);

bot.action('admin_stats', statsPanel);

bot.action('admin_users', async (ctx) => {
  if (!isAdmin(ctx.from.id)) return;
  await ctx.answerCbQuery().catch(() => {});
  const count = db.getUserCount();
  await ctx.reply(`👥 Jami foydalanuvchilar: *${count}* ta`, {
    parse_mode: 'Markdown',
  });
});

// ─── XATO HANDLER ────────────────────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Bot xatosi [${ctx?.updateType}]:`, err);
});

// ─── BOTNI ISHGA TUSHIRISH ────────────────────────────────────────────────────
bot.launch({
  // Render.com da webhook ishlatish tavsiya etiladi, lekin polling ham ishlaydi
  dropPendingUpdates: true,
})
  .then(() => console.log('🤖 Bot muvaffaqiyatli ishga tushdi!'))
  .catch((err) => {
    console.error('Bot ishga tushmadi:', err);
    process.exit(1);
  });

process.once('SIGINT', () => {
  console.log('Bot to\'xtatilmoqda (SIGINT)...');
  bot.stop('SIGINT');
});
process.once('SIGTERM', () => {
  console.log('Bot to\'xtatilmoqda (SIGTERM)...');
  bot.stop('SIGTERM');
});
