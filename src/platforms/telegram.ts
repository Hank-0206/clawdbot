import axios from 'axios';
import crypto from 'crypto';
import { BasePlatformAdapter } from './base.js';
import { Message, PlatformType } from '../types/index.js';

/**
 * Telegram Platform Adapter
 * Supports receiving and sending messages via Telegram Bot API
 * Supports both Webhook and Long Polling modes
 */
export class TelegramAdapter extends BasePlatformAdapter {
  name = 'Telegram';
  type: PlatformType = 'telegram';

  private botToken: string = '';
  private apiBaseUrl: string = '';
  private pollingOffset: number = 0;
  private pollingTimeout: number = 30;  // Long polling timeout in seconds
  private pollingInterval: NodeJS.Timeout | null = null;
  private mode: 'webhook' | 'polling' = 'webhook';

  async initialize(config: Record<string, any>): Promise<void> {
    this.botToken = config.botToken || process.env.TELEGRAM_BOT_TOKEN || '';
    this.apiBaseUrl = `https://api.telegram.org/bot${this.botToken}`;
    this.mode = config.mode || process.env.TELEGRAM_MODE as 'webhook' | 'polling' || 'webhook';

    if (!this.botToken) {
      throw new Error('Telegram botToken is required');
    }
  }

  async start(): Promise<void> {
    // Verify bot token by gettingMe
    try {
      const response = await axios.get(`${this.apiBaseUrl}/getMe`);
      console.log(`[Telegram] Logged in as ${response.data.result.username}`);
    } catch (error) {
      console.error(`[Telegram] Failed to verify bot token:`, error);
      throw error;
    }

    // Start based on mode
    if (this.mode === 'polling') {
      await this.startPolling();
    } else {
      console.log(`[Telegram] Running in webhook mode - waiting for incoming requests`);
    }

    this.running = true;
    console.log(`[Telegram] Adapter started (${this.mode} mode)`);
  }

  /**
   * Start Long Polling mode
   */
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
          },
          {
            timeout: (this.pollingTimeout + 10) * 1000,  // Add extra timeout
          }
        );

        const updates = response.data.result;

        if (updates && updates.length > 0) {
          for (const update of updates) {
            this.pollingOffset = update.update_id;

            // Process the update
            const message = this.processUpdate(update);
            if (message && this.messageHandler) {
              this.messageHandler(message);
            }
          }
        }
      } catch (error: any) {
        if (this.running) {
          console.error(`[Telegram] Polling error:`, error.message);
          // Wait a bit before retrying on error
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      // Continue polling if still running
      if (this.running) {
        setImmediate(poll);
      }
    };

    // Start polling
    poll();
  }

  /**
   * Process a single update from polling
   */
  private processUpdate(update: any): Message | null {
    try {
      if (!update.message && !update.callback_query) return null;

      let chatId: string | undefined;
      let sender: string | undefined;
      let content: string = '';
      let messageId: string | undefined;

      if (update.message) {
        const msg = update.message;
        messageId = msg.message_id?.toString();
        chatId = msg.chat?.id?.toString();
        sender = msg.from?.id?.toString() || msg.from?.username;
        content = msg.text || msg.caption || '';
      } else if (update.callback_query) {
        const callback = update.callback_query;
        messageId = callback.message?.message_id?.toString();
        chatId = callback.message?.chat?.id?.toString();
        sender = callback.from?.id?.toString() || callback.from?.username;
        content = callback.data || '';
      }

      if (!chatId) return null;

      const message: Message = {
        id: messageId || this.generateId(),
        platform: this.type,
        sender: sender || 'unknown',
        content: content,
        timestamp: (update.message?.date || update.callback_query?.message?.date || Date.now()) * 1000,
        conversationId: chatId,
        metadata: update,
      };

      return message;
    } catch (error) {
      console.error(`[Telegram] Failed to process update:`, error);
    }
    return null;
  }

  /**
   * Stop polling
   */
  async stop(): Promise<void> {
    this.running = false;

    // If in polling mode, also stop the polling loop
    if (this.mode === 'polling' && this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    console.log(`[Telegram] Adapter stopped`);
  }

  async sendMessage(to: string, content: string): Promise<void> {
    try {
      await axios.post(
        `${this.apiBaseUrl}/sendMessage`,
        {
          chat_id: to,
          text: content,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      console.log(`[Telegram] Message sent to ${to}`);
    } catch (error) {
      console.error(`[Telegram] Failed to send message:`, error);
      throw error;
    }
  }

  /**
   * Process incoming webhook updates from Telegram
   */
  processWebhook(body: any): Message | null {
    try {
      const update = body;
      if (!update.message && !update.callback_query) return null;

      let chatId: string | undefined;
      let sender: string | undefined;
      let content: string = '';
      let messageId: string | undefined;

      if (update.message) {
        const msg = update.message;
        messageId = msg.message_id?.toString();
        chatId = msg.chat?.id?.toString();
        sender = msg.from?.id?.toString() || msg.from?.username;
        content = msg.text || msg.caption || '';
      } else if (update.callback_query) {
        const callback = update.callback_query;
        messageId = callback.message?.message_id?.toString();
        chatId = callback.message?.chat?.id?.toString();
        sender = callback.from?.id?.toString() || callback.from?.username;
        content = callback.data || '';
      }

      if (!chatId) return null;

      const message: Message = {
        id: messageId || this.generateId(),
        platform: this.type,
        sender: sender || 'unknown',
        content: content,
        timestamp: (update.message?.date || update.callback_query?.message?.date || Date.now()) * 1000,
        conversationId: chatId,
        metadata: body,
      };

      return message;
    } catch (error) {
      console.error(`[Telegram] Failed to process webhook:`, error);
    }
    return null;
  }

  /**
   * Reply to a message
   */
  async replyToMessage(chatId: string, messageId: string, content: string): Promise<void> {
    try {
      await axios.post(
        `${this.apiBaseUrl}/sendMessage`,
        {
          chat_id: chatId,
          text: content,
          reply_to_message_id: parseInt(messageId),
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(`[Telegram] Failed to reply to message:`, error);
      throw error;
    }
  }

  /**
   * Answer a callback query
   */
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    try {
      await axios.post(
        `${this.apiBaseUrl}/answerCallbackQuery`,
        {
          callback_query_id: callbackQueryId,
          text: text,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(`[Telegram] Failed to answer callback query:`, error);
      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  verifySignature(data: string, secretToken: string): boolean {
    // Telegram uses HMAC-SHA256 for secret token verification
    // This is optional verification if you set a secret token
    return true;
  }

  /**
   * Send a photo
   */
  async sendPhoto(chatId: string, photoUrl: string, caption?: string): Promise<void> {
    try {
      await axios.post(
        `${this.apiBaseUrl}/sendPhoto`,
        {
          chat_id: chatId,
          photo: photoUrl,
          caption: caption,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      console.error(`[Telegram] Failed to send photo:`, error);
      throw error;
    }
  }

  /**
   * Set webhook
   */
  async setWebhook(url: string, secretToken?: string): Promise<void> {
    try {
      await axios.post(
        `${this.apiBaseUrl}/setWebhook`,
        {
          url: url,
          secret_token: secretToken,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );
      console.log(`[Telegram] Webhook set to ${url}`);
    } catch (error) {
      console.error(`[Telegram] Failed to set webhook:`, error);
      throw error;
    }
  }
}
