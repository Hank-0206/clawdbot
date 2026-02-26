import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { BasePlatformAdapter } from './base.js';
import { Message, PlatformType, SendMessageOptions, ImageAttachment } from '../types/index.js';

/**
 * Telegram Platform Adapter
 * Supports both Webhook and Long Polling modes
 */
export class TelegramAdapter extends BasePlatformAdapter {
  name = 'Telegram';
  type: PlatformType = 'telegram';

  private botToken: string = '';
  private apiBaseUrl: string = '';
  private pollingOffset: number = 0;
  private pollingTimeout: number = 30;
  private mode: 'webhook' | 'polling' = 'polling';

  async initialize(config: Record<string, any>): Promise<void> {
    this.botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
    this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.mode = config.mode || process.env.TELEGRAM_MODE as 'webhook' | 'polling' || 'polling';

    if (!this.botToken) {
      throw new Error('Telegram botToken is required');
    }
  }

  async start(): Promise<void> {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/getMe`);
      console.log(`[Telegram] Logged in as @${response.data.result.username}`);
    } catch (error) {
      console.error(`[Telegram] Failed to verify bot token:`, error);
      throw error;
    }

    if (this.mode === 'polling') {
      // Delete any existing webhook before starting polling
      try {
        await axios.post(`${this.apiBaseUrl}/deleteWebhook`);
      } catch { /* ignore */ }
      await this.startPolling();
    } else {
      console.log(`[Telegram] Running in webhook mode`);
    }

    this.running = true;
    console.log(`[Telegram] Adapter started (${this.mode} mode)`);
  }

  private async startPolling(): Promise<void> {
    console.log(`[Telegram] Starting Long Polling...`);

    const poll = async () => {
      if (!this.running) return;

      try {
        const response = await axios.post(
          `${this.apiBaseUrl}/getUpdates`,
          {
            offset: this.pollingOffset + 1,
            timeout: this.pollingTimeout,
            allowed_updates: ['message', 'callback_query'],
          },
          {
            timeout: (this.pollingTimeout + 10) * 1000,
          }
        );

        const updates = response.data.result;
        if (updates && updates.length > 0) {
          for (const update of updates) {
            this.pollingOffset = update.update_id;
            const message = await this.processUpdate(update);
            if (message && this.messageHandler) {
              // Don't await - process messages concurrently
              this.messageHandler(message);
            }
          }
        }
      } catch (error: any) {
        if (this.running) {
          console.error(`[Telegram] Polling error:`, error.message);
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      if (this.running) {
        setImmediate(poll);
      }
    };

    this.running = true;
    poll();
  }

  private async processUpdate(update: any): Promise<Message | null> {
    try {
      if (!update.message && !update.callback_query) return null;

      let chatId: string | undefined;
      let sender: string | undefined;
      let content: string = '';
      let messageId: string | undefined;
      let senderName: string | undefined;
      let images: ImageAttachment[] | undefined;

      if (update.message) {
        const msg = update.message;
        messageId = msg.message_id?.toString();
        chatId = msg.chat?.id?.toString();
        sender = msg.from?.id?.toString();
        senderName = msg.from?.first_name || msg.from?.username || 'Unknown';
        content = msg.text || msg.caption || '';

        // Handle photos
        if (msg.photo && msg.photo.length > 0) {
          const largestPhoto = msg.photo[msg.photo.length - 1];
          const attachment = await this.downloadPhoto(largestPhoto.file_id);
          if (attachment) {
            images = [attachment];
          }
          if (!content) {
            content = "What's in this image?";
          }
        }

        // Handle /start command
        if (content === '/start') {
          content = 'Hello! I just started the bot.';
        }
      } else if (update.callback_query) {
        const callback = update.callback_query;
        messageId = callback.message?.message_id?.toString();
        chatId = callback.message?.chat?.id?.toString();
        sender = callback.from?.id?.toString();
        senderName = callback.from?.first_name || callback.from?.username;
        content = callback.data || '';
      }

      if (!chatId || (!content && (!images || images.length === 0))) return null;

      return {
        id: messageId || this.generateId(),
        platform: this.type,
        sender: sender || 'unknown',
        content,
        timestamp: (update.message?.date || Date.now() / 1000) * 1000,
        conversationId: chatId,
        images,
        metadata: {
          senderName,
          messageId,
          chatType: update.message?.chat?.type,
          raw: update,
        },
      };
    } catch (error) {
      console.error(`[Telegram] Failed to process update:`, error);
      return null;
    }
  }

  /**
   * Download a photo from Telegram servers and return as base64
   */
  private async downloadPhoto(fileId: string): Promise<ImageAttachment | null> {
    try {
      const fileResponse = await axios.get(`${this.apiBaseUrl}/getFile`, {
        params: { file_id: fileId },
      });
      const filePath = fileResponse.data.result.file_path;

      const fileUrl = `https://api.telegram.org/file/bot${this.botToken}/${filePath}`;
      const imageResponse = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
      });

      const base64 = Buffer.from(imageResponse.data).toString('base64');

      const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg';
      const mediaTypeMap: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
      };

      return { base64, mediaType: mediaTypeMap[ext] || 'image/jpeg' };
    } catch (error: any) {
      console.error(`[Telegram] Failed to download photo:`, error.message);
      return null;
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    console.log(`[Telegram] Adapter stopped`);
  }

  /**
   * Send a text message to a chat
   */
  async sendMessage(to: string, content: string, options?: SendMessageOptions): Promise<void> {
    if (!content || !content.trim()) return;

    try {
      await axios.post(`${this.apiBaseUrl}/sendMessage`, {
        chat_id: to,
        text: content,
        parse_mode: options?.parseMode,
        reply_to_message_id: options?.replyToMessageId ? parseInt(options.replyToMessageId) : undefined,
      });
    } catch (error: any) {
      // If markdown parsing fails, retry without parse_mode
      if (options?.parseMode && error.response?.data?.description?.includes('parse')) {
        await axios.post(`${this.apiBaseUrl}/sendMessage`, {
          chat_id: to,
          text: content,
        });
        return;
      }
      console.error(`[Telegram] Failed to send message:`, error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Send typing indicator
   */
  async sendChatAction(chatId: string, action: string = 'typing'): Promise<void> {
    try {
      await axios.post(`${this.apiBaseUrl}/sendChatAction`, {
        chat_id: chatId,
        action,
      });
    } catch {
      // Ignore errors for typing indicator
    }
  }

  /**
   * Reply to a specific message
   */
  async replyToMessage(chatId: string, messageId: string, content: string): Promise<void> {
    await this.sendMessage(chatId, content, { replyToMessageId: messageId });
  }

  /**
   * Answer a callback query
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await axios.post(`${this.apiBaseUrl}/answerCallbackQuery`, {
        callback_query_id: callbackQueryId,
        text,
      });
    } catch (error) {
      console.error(`[Telegram] Failed to answer callback query:`, error);
    }
  }

  /**
   * Send a photo - supports both URL and local file path
   */
  async sendPhoto(chatId: string, photoSource: string, caption?: string): Promise<void> {
    try {
      // Check if it's a local file
      if (fs.existsSync(photoSource)) {
        const fileStream = fs.createReadStream(photoSource);
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('chat_id', chatId);
        form.append('photo', fileStream, path.basename(photoSource));
        if (caption) form.append('caption', caption);

        await axios.post(`${this.apiBaseUrl}/sendPhoto`, form, {
          headers: form.getHeaders(),
        });
      } else {
        // Treat as URL
        await axios.post(`${this.apiBaseUrl}/sendPhoto`, {
          chat_id: chatId,
          photo: photoSource,
          caption,
        });
      }
    } catch (error) {
      console.error(`[Telegram] Failed to send photo:`, error);
      throw error;
    }
  }

  /**
   * Process incoming webhook update
   */
  async processWebhook(body: any): Promise<Message | null> {
    return this.processUpdate(body);
  }

  /**
   * Set webhook URL
   */
  async setWebhook(url: string, secretToken?: string): Promise<void> {
    try {
      await axios.post(`${this.apiBaseUrl}/setWebhook`, {
        url,
        secret_token: secretToken,
      });
      console.log(`[Telegram] Webhook set to ${url}`);
    } catch (error) {
      console.error(`[Telegram] Failed to set webhook:`, error);
      throw error;
    }
  }
}
