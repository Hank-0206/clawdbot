import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export interface PairedUser {
  platform: string;
  userId: string;
  pairedAt: number;
  approved: boolean;
}

const CONFIG_DIR = path.join(process.env.HOME || process.env.USERPROFILE || '.', '.copy-clawd');
const PAIRING_FILE = path.join(CONFIG_DIR, 'paired-users.json');

export class PairingManager {
  private pairedUsers: Map<string, PairedUser> = new Map();
  private pendingPairingCodes: Map<string, { platform: string; userId: string; expiresAt: number }> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(PAIRING_FILE)) {
        const data = JSON.parse(fs.readFileSync(PAIRING_FILE, 'utf-8'));
        for (const [key, user] of Object.entries(data)) {
          this.pairedUsers.set(key, user as PairedUser);
        }
      }
    } catch (error) {
      console.error('Failed to load paired users:', error);
    }
  }

  private save(): void {
    try {
      if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
      }
      const data: Record<string, PairedUser> = {};
      for (const [key, user] of this.pairedUsers) {
        data[key] = user;
      }
      fs.writeFileSync(PAIRING_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save paired users:', error);
    }
  }

  /**
   * Generate a unique key for a user
   */
  private getUserKey(platform: string, userId: string): string {
    return `${platform}:${userId}`;
  }

  /**
   * Check if a user is approved
   */
  isApproved(platform: string, userId: string): boolean {
    const user = this.pairedUsers.get(this.getUserKey(platform, userId));
    return user?.approved || false;
  }

  /**
   * Check if a user is paired (but not necessarily approved)
   */
  isPaired(platform: string, userId: string): boolean {
    return this.pairedUsers.has(this.getUserKey(platform, userId));
  }

  /**
   * Create a pairing code for a new user
   */
  createPairingCode(platform: string, userId: string): string {
    const code = crypto.randomBytes(3).toString('hex').toUpperCase();
    this.pendingPairingCodes.set(code, {
      platform,
      userId,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    });
    return code;
  }

  /**
   * Approve a user with a pairing code
   */
  approveByCode(code: string): { success: boolean; message: string } {
    const pending = this.pendingPairingCodes.get(code);

    if (!pending) {
      return { success: false, message: 'Invalid or expired pairing code' };
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingPairingCodes.delete(code);
      return { success: false, message: 'Pairing code expired' };
    }

    const user: PairedUser = {
      platform: pending.platform,
      userId: pending.userId,
      pairedAt: Date.now(),
      approved: true,
    };

    this.pairedUsers.set(this.getUserKey(pending.platform, pending.userId), user);
    this.pendingPairingCodes.delete(code);
    this.save();

    return { success: true, message: `User ${pending.userId} approved successfully` };
  }

  /**
   * Approve a user directly
   */
  approveUser(platform: string, userId: string): void {
    const user: PairedUser = {
      platform,
      userId,
      pairedAt: Date.now(),
      approved: true,
    };
    this.pairedUsers.set(this.getUserKey(platform, userId), user);
    this.save();
  }

  /**
   * Remove/revoke a user
   */
  removeUser(platform: string, userId: string): void {
    this.pairedUsers.delete(this.getUserKey(platform, userId));
    this.save();
  }

  /**
   * Get list of all paired users
   */
  getPairedUsers(): PairedUser[] {
    return Array.from(this.pairedUsers.values());
  }

  /**
   * Get list of approved users
   */
  getApprovedUsers(): PairedUser[] {
    return Array.from(this.pairedUsers.values()).filter(u => u.approved);
  }

  /**
   * Clean up expired pairing codes
   */
  cleanup(): void {
    const now = Date.now();
    for (const [code, pending] of this.pendingPairingCodes) {
      if (now > pending.expiresAt) {
        this.pendingPairingCodes.delete(code);
      }
    }
  }
}

export const pairingManager = new PairingManager();
