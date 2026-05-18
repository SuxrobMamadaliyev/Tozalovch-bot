const { TelegramClient } = require('gramjs');
const { StringSession } = require('gramjs/sessions');
const { Api } = require('gramjs');

const API_ID = parseInt(process.env.API_ID);
const API_HASH = process.env.API_HASH;

class UserSession {
  constructor(userId) {
    this.userId = userId;
    this.session = new StringSession('');
    this.client = new TelegramClient(this.session, API_ID, API_HASH, {
      connectionRetries: 5,
    });
    this.phone = null;
    this.phoneCodeHash = null;
    this._authorized = false;
  }

  async sendCode(phone) {
    this.phone = phone;
    await this.client.connect();
    const result = await this.client.sendCode(
      { apiId: API_ID, apiHash: API_HASH },
      phone
    );
    this.phoneCodeHash = result.phoneCodeHash;
  }

  async signIn(phone, code) {
    // Kod orasidagi bo'shliqlarni olib tashlaymiz
    const cleanCode = String(code).replace(/\s+/g, '');
    const result = await this.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash: this.phoneCodeHash,
        phoneCode: cleanCode,
      })
    );
    this._authorized = true;
    return result;
  }

  async checkPassword(password) {
    await this.client.signInWithPassword(
      { apiId: API_ID, apiHash: API_HASH },
      {
        password: async () => password,
        onError: (err) => {
          throw err;
        },
      }
    );
    this._authorized = true;
  }

  isAuthorized() {
    return this._authorized;
  }

  async getDialogs(type) {
    const allDialogs = await this.client.getDialogs({ limit: 200 });
    const results = [];

    for (const dialog of allDialogs) {
      const entity = dialog.entity;
      if (!entity) continue;

      const isChannel =
        entity.className === 'Channel' && entity.broadcast === true;
      const isGroup =
        entity.className === 'Chat' ||
        (entity.className === 'Channel' && !entity.broadcast);
      const isBot = entity.className === 'User' && entity.bot === true;

      let matched = false;
      if (type === 'channels' && isChannel) matched = true;
      else if (type === 'groups' && isGroup) matched = true;
      else if (type === 'bots' && isBot) matched = true;
      else if (type === 'all' && (isChannel || isGroup || isBot)) matched = true;

      if (matched) {
        results.push({
          // BigInt ni string ga o'tkazamiz
          id: entity.id.toString(),
          title: dialog.title || entity.username || 'Nomsiz',
          type: isChannel ? 'kanal' : isGroup ? 'guruh' : 'bot',
          entityClass: entity.className,
        });
      }
    }

    return results;
  }

  async leaveDialog(dialogInfo) {
    // dialogInfo - { id, entityClass } yoki faqat id (string)
    const id = typeof dialogInfo === 'object' ? dialogInfo.id : String(dialogInfo);
    const entityClass =
      typeof dialogInfo === 'object' ? dialogInfo.entityClass : null;

    try {
      const entity = await this.client.getEntity(id);

      if (entity.className === 'User') {
        // Bot yoki foydalanuvchi - dialog o'chirish
        await this.client.invoke(
          new Api.messages.DeleteHistory({
            peer: entity,
            maxId: 0,
            revoke: false,
          })
        );
      } else if (
        entity.className === 'Channel' ||
        entity.className === 'Chat'
      ) {
        // Kanal yoki guruh - chiqish
        try {
          await this.client.invoke(
            new Api.channels.LeaveChannel({ channel: entity })
          );
        } catch (leaveErr) {
          // Eski tipli guruhlar (Chat) uchun
          if (
            entity.className === 'Chat' ||
            leaveErr.message.includes('CHANNEL_PRIVATE')
          ) {
            await this.client.invoke(
              new Api.messages.DeleteChatUser({
                chatId: entity.id,
                userId: new Api.InputUserSelf(),
              })
            );
          } else {
            throw leaveErr;
          }
        }
      }
    } catch (err) {
      // getEntity muvaffaqiyatsiz bo'lsa ham urinib ko'ramiz
      if (err.message && err.message.includes('Could not find')) {
        throw new Error(`Dialog topilmadi (ID: ${id})`);
      }
      throw err;
    }
  }

  // Sessiyani string sifatida saqlash (ixtiyoriy)
  getSessionString() {
    return this.client.session.save();
  }

  async disconnect() {
    try {
      await this.client.disconnect();
    } catch (_) {}
    this._authorized = false;
  }
}

module.exports = UserSession;
