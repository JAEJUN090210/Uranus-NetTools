import type { Socket } from 'node:net';

import { UserError } from '../../cli/errors';

export const STARTTLS_PROTOCOLS = ['smtp', 'imap', 'pop3', 'ftp'] as const;
export type StartTlsProtocol = (typeof STARTTLS_PROTOCOLS)[number];

/** 평문으로 시작하는 서비스의 기본 포트입니다. */
export const STARTTLS_PORTS: Readonly<Record<StartTlsProtocol, number>> = {
  smtp: 587,
  imap: 143,
  pop3: 110,
  ftp: 21,
};

export function isStartTlsProtocol(value: string): value is StartTlsProtocol {
  return (STARTTLS_PROTOCOLS as readonly string[]).includes(value);
}

interface Step {
  /** 보낼 명령입니다. 없으면 인사말만 기다립니다. */
  readonly send?: string;
  /** 응답이 끝났는지 판단합니다. */
  readonly done: (text: string) => boolean;
  /** 응답이 성공인지 판단합니다. */
  readonly ok: (text: string) => boolean;
}

const IMAP_TAG = 'unt1';

/** 서비스마다 TLS로 넘어가기 전에 주고받아야 하는 순서입니다. */
const CONVERSATIONS: Readonly<Record<StartTlsProtocol, readonly Step[]>> = {
  smtp: [
    { done: (text) => /^\d{3} /m.test(text), ok: (text) => text.startsWith('220') },
    {
      send: 'EHLO uranus-nettools\r\n',
      // 여러 줄 응답은 마지막 줄만 "250 "(하이픈 없이)로 시작합니다.
      done: (text) => /^250 /m.test(text),
      ok: (text) => /^250[ -]/.test(text),
    },
    {
      send: 'STARTTLS\r\n',
      done: (text) => /^\d{3} /m.test(text),
      ok: (text) => text.startsWith('220'),
    },
  ],
  imap: [
    { done: (text) => text.includes('\n'), ok: (text) => text.startsWith('* OK') },
    {
      send: `${IMAP_TAG} STARTTLS\r\n`,
      done: (text) => new RegExp(`^${IMAP_TAG} `, 'm').test(text),
      ok: (text) => new RegExp(`^${IMAP_TAG} OK`, 'm').test(text),
    },
  ],
  pop3: [
    { done: (text) => text.includes('\n'), ok: (text) => text.startsWith('+OK') },
    {
      send: 'STLS\r\n',
      done: (text) => text.includes('\n'),
      ok: (text) => text.startsWith('+OK'),
    },
  ],
  ftp: [
    { done: (text) => /^\d{3} /m.test(text), ok: (text) => text.startsWith('220') },
    {
      send: 'AUTH TLS\r\n',
      done: (text) => /^\d{3} /m.test(text),
      ok: (text) => /^23[04]/.test(text),
    },
  ],
};

export interface StartTlsOptions {
  readonly host: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

/**
 * 평문 연결에서 서비스와 몇 마디 주고받아 TLS로 전환할 준비를 합니다.
 * 이 함수가 끝난 뒤 같은 소켓 위에서 TLS 핸드셰이킹을 하면 됩니다.
 */
export async function startTlsOn(
  socket: Socket,
  protocol: StartTlsProtocol,
  options: StartTlsOptions,
): Promise<void> {
  for (const step of CONVERSATIONS[protocol]) {
    if (step.send !== undefined) {
      socket.write(step.send);
    }
    const reply = await readReply(socket, step.done, options);
    if (!step.ok(reply)) {
      const first = reply.split(/\r?\n/)[0] ?? '';
      throw new UserError(
        `${options.host} did not agree to STARTTLS over ${protocol}: ${first.trim()}`,
      );
    }
  }
}

function readReply(
  socket: Socket,
  done: (text: string) => boolean,
  options: StartTlsOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const finish = (error?: Error) => {
      clearTimeout(timer);
      options.signal.removeEventListener('abort', onAbort);
      socket.removeListener('data', onData);
      socket.removeListener('error', finish);
      socket.removeListener('close', onClose);
      if (error === undefined) {
        resolve(text);
      } else {
        reject(error);
      }
    };
    const onAbort = () => {
      finish(options.signal.reason as Error);
    };
    const onData = (chunk: Buffer) => {
      text += chunk.toString('latin1');
      if (done(text)) {
        finish();
      }
    };
    const onClose = () => {
      finish(new UserError(`${options.host} closed the connection during STARTTLS`));
    };

    const timer = setTimeout(() => {
      finish(new UserError(`${options.host} did not answer during STARTTLS`));
    }, options.timeoutMs);
    options.signal.addEventListener('abort', onAbort, { once: true });
    socket.on('data', onData);
    socket.once('error', finish);
    socket.once('close', onClose);
  });
}
