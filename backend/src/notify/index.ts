import webpush from 'web-push';
import { sendEmail } from './email.js';
import { getVapid, listEnabledChannels, setVapid } from './repo.js';
import { sendSlack } from './slack.js';
import { sendTelegram } from './telegram.js';
import type {
  ChannelType,
  EmailConfig,
  NotifyLevel,
  NotifyMessage,
  SlackConfig,
  TelegramConfig,
} from './types.js';
import { sendWebPush } from './webpush.js';

/** Generate a VAPID keypair on first run so web push works out of the box. */
export function initNotify(): void {
  if (!getVapid()) setVapid(webpush.generateVAPIDKeys());
}

async function sendVia(
  type: ChannelType,
  config: Record<string, unknown>,
  msg: NotifyMessage,
): Promise<void> {
  switch (type) {
    case 'email':
      return sendEmail(config as unknown as EmailConfig, msg);
    case 'telegram':
      return sendTelegram(config as unknown as TelegramConfig, msg);
    case 'slack':
      return sendSlack(config as unknown as SlackConfig, msg);
    case 'webpush':
      return sendWebPush(msg);
  }
}

const RANK: Record<NotifyLevel, number> = { info: 0, warn: 1, crit: 2 };

/**
 * Fan out a message to every enabled channel whose minimum severity it meets
 * (e.g. a 'crit'-only channel skips warnings and resolved/info notes). Per-channel
 * failures are logged, not thrown.
 */
export async function dispatch(msg: NotifyMessage): Promise<void> {
  await Promise.all(
    listEnabledChannels()
      .filter((c) => RANK[msg.level] >= RANK[c.minLevel])
      .map(async (c) => {
        try {
          await sendVia(c.type, c.config, msg);
        } catch (err) {
          console.error(`notify: ${c.type} "${c.name}" failed: ${(err as Error).message}`);
        }
      }),
  );
}

export async function testChannel(
  type: ChannelType,
  config: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  try {
    await sendVia(type, config, {
      title: 'ProxView test notification',
      body: 'If you can read this, this channel is working. 🎉',
      level: 'info',
    });
    return { ok: true, message: 'Test notification sent.' };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}
