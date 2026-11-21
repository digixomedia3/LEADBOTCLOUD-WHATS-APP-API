import { createServer, type Server } from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * A tiny SMTP server for tests: accepts mail on a local port and keeps what it was given, so a test can read the message a person
 * would receive instead of trusting a mock. Plain text, no auth, no TLS: only what nodemailer needs for a local port.
 */
export interface Captured { from: string; to: string[]; data: string }

export async function startSmtp(opts: { rejectRecipient?: RegExp } = {}): Promise<{ port: number; mails: Captured[]; close: () => Promise<void> }> {
  const mails: Captured[] = [];
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((sock) => {
    sockets.add(sock); sock.on('close', () => sockets.delete(sock)); sock.on('error', () => {});
    let cur: Captured = { from: '', to: [], data: '' }; let inData = false; let buf = '';
    const say = (s: string) => sock.write(s + '\r\n');
    say('220 test ESMTP');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      for (;;) {
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end === -1) return;
          cur.data = buf.slice(0, end); buf = buf.slice(end + 5); inData = false;
          mails.push(cur); cur = { from: '', to: [], data: '' }; say('250 queued'); continue;
        }
        const nl = buf.indexOf('\r\n'); if (nl === -1) return;
        const line = buf.slice(0, nl); buf = buf.slice(nl + 2); const up = line.toUpperCase();
        if (up.startsWith('EHLO')) { sock.write('250-test\r\n250 8BITMIME\r\n'); }
        else if (up.startsWith('HELO')) say('250 test');
        else if (up.startsWith('MAIL FROM')) { cur.from = /<([^>]*)>/.exec(line)?.[1] ?? ''; say('250 ok'); }
        else if (up.startsWith('RCPT TO')) {
          const to = /<([^>]*)>/.exec(line)?.[1] ?? '';
          if (opts.rejectRecipient?.test(to)) { say('550 no such user'); } else { cur.to.push(to); say('250 ok'); }
        }
        else if (up === 'DATA') { inData = true; say('354 go'); }
        else if (up === 'QUIT') { say('221 bye'); sock.end(); }
        else say('250 ok');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return {
    port: (server.address() as AddressInfo).port, mails,
    close: () => new Promise<void>((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

/** Decodes the quoted-printable / base64 body nodemailer produces, so tests can search the readable text. */
export function readable(data: string): string {
  const unfolded = data.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
  const b64 = [...data.matchAll(/Content-Transfer-Encoding: base64\r?\n\r?\n([\s\S]*?)(?:\r?\n--|\r?\n\r?\n|$)/gi)].map((m) => Buffer.from(m[1]!.replace(/\s+/g, ''), 'base64').toString('utf8'));
  return [unfolded, ...b64].join('\n');
}
