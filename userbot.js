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
    const result = await this.client.sendCode({ apiId: API_ID, apiHash: API_HASH }, phone);
    this.phoneCodeHash = result.phoneCodeHash;
  }

  async signIn(phone, code) {
    const result = await this.client.invoke(
      new Api.auth.SignIn({
        phoneNumber: phone,
        phoneCodeHash: this.phoneCodeHash,
        phoneCode: code,
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
        onError: (err) => { throw err; },
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

      const isChannel = entity.className === 'Channel' && entity.broadcast;
      const isGroup =
        entity.className === 'Chat' ||
        (entity.className === 'Channel' && !entity.broadcast);
      const isBot = entity.className === 'User' && entity.bot;

      if (
        (type === 'channels' && isChannel) ||
        (type === 'groups' && isGroup) ||
        (type === 'bots' && isBot) ||
        type === 'all'
      ) {
        results.push({
          id: entity.id.toString(),
          title: dialog.title || entity.username || 'Nomsiz',
          type: isChannel ? 'kanal' : isGroup ? 'guruh' : 'bot',
        });
      }
    }

    return results;
  }

  async leaveDialog(id) {
    try {
      const entity = await this.client.getEntity(id);
      if (entity.className === 'User') {
        // Bot - bloklash yoki dialog o'chirish
        await this.client.invoke(new Api.contacts.Block({ id: entity }));
      } else {
        await this.client.invoke(new Api.channels.LeaveChannel({ channel: entity }));
      }
    } catch {
      await this.client.invoke(new Api.messages.DeleteChatUser({
        chatId: id,
        userId: 'me',
      }));
    }
  }
}

module.exports = UserSession;
