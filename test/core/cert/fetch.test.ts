import {
  type AddressInfo,
  createServer as createTcpServer,
  type Server,
  type Socket,
} from 'node:net';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:tls';

import { afterEach, describe, expect, it } from 'vitest';

import { describeCertificate, matchesHost, subjectNames } from '../../../src/core/cert/describe';
import { fetchCertificate } from '../../../src/core/cert/fetch';
import { STARTTLS_PORTS } from '../../../src/core/cert/starttls';
import { TEST_TLS_CERT, TEST_TLS_KEY } from '../../fixtures/tls';

const servers: (Server | TlsServer)[] = [];
const sockets: Socket[] = [];

/** 열린 연결이 남아 있으면 close가 끝나지 않으므로 소켓을 먼저 끊습니다. */
async function closeAll(): Promise<void> {
  for (const socket of sockets.splice(0)) {
    socket.destroy();
  }
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => {
            resolve();
          });
        }),
    ),
  );
}

afterEach(closeAll);

async function listen(server: Server | TlsServer): Promise<number> {
  servers.push(server);
  server.on('connection', (socket: Socket) => {
    sockets.push(socket);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return (server.address() as AddressInfo).port;
}

const base = { host: '127.0.0.1', timeoutMs: 5000, signal: new AbortController().signal };

describe('STARTTLS_PORTS', () => {
  it('knows the usual plain-text ports', () => {
    expect(STARTTLS_PORTS).toEqual({ smtp: 587, imap: 143, pop3: 110, ftp: 21 });
  });
});

describe('fetchCertificate', () => {
  it('reads a self-signed certificate without refusing it, and says it is not trusted', async () => {
    const port = await listen(createTlsServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }));

    const result = await fetchCertificate({ ...base, port });

    expect(result.trusted).toBe(false);
    expect(result.trustError).toBeTypeOf('string');
    expect(result.protocol).toMatch(/^TLSv1/);
    expect(result.cipher).toBeTypeOf('string');
    expect(result.elapsed).toBeGreaterThanOrEqual(0);

    const info = describeCertificate(result.certificate);
    expect(info.subject).toBe('localhost');
    // 테스트 인증서는 2126년까지 유효합니다.
    expect(info.daysLeft).toBeGreaterThan(0);
    expect(info.key).toContain('EC');
    expect(subjectNames(result.certificate)).toEqual(['localhost', '127.0.0.1']);
    expect(matchesHost(info.names, '127.0.0.1')).toBe(true);
    expect(matchesHost(info.names, 'example.com')).toBe(false);
  });

  it('explains a port that does not speak TLS', async () => {
    const port = await listen(
      createTcpServer((socket) => {
        socket.on('error', () => undefined);
        socket.end('plain text\r\n');
      }),
    );

    await expect(fetchCertificate({ ...base, port })).rejects.toThrow(/--starttls|TLS/);
  });

  it('explains a refused connection', async () => {
    const port = await listen(createTcpServer());
    await closeAll();

    await expect(fetchCertificate({ ...base, port })).rejects.toThrow('refused the connection');
  });

  it('is rejected once cancelled', async () => {
    const port = await listen(createTlsServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }));
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchCertificate({ ...base, port, signal: controller.signal }),
    ).rejects.toBeDefined();
  });

  describe('over STARTTLS', () => {
    /** 인사말과 STARTTLS 명령에만 답하고 TLS로 넘어가는 가짜 SMTP 서버입니다. */
    async function fakeSmtp(replies: { ehlo?: string; starttls?: string } = {}): Promise<number> {
      const tls = createTlsServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT });
      servers.push(tls);
      const server = createTcpServer((socket) => {
        socket.on('error', () => undefined);
        socket.write('220 fake ESMTP ready\r\n');
        socket.on('data', (chunk: Buffer) => {
          const line = chunk.toString('latin1');
          if (line.startsWith('EHLO')) {
            socket.write(replies.ehlo ?? '250-fake\r\n250 STARTTLS\r\n');
          } else if (line.startsWith('STARTTLS')) {
            const reply = replies.starttls ?? '220 go ahead\r\n';
            socket.write(reply);
            if (reply.startsWith('220')) {
              // 같은 소켓을 TLS 서버에 넘겨 핸드셰이킹을 맡깁니다.
              socket.removeAllListeners('data');
              tls.emit('connection', socket);
            }
          }
        });
      });
      return listen(server);
    }

    it('upgrades a plain SMTP connection and reads the certificate', async () => {
      const port = await fakeSmtp();

      const result = await fetchCertificate({ ...base, port, starttls: 'smtp' });

      expect(describeCertificate(result.certificate).subject).toBe('localhost');
    });

    it('stops when the server refuses STARTTLS', async () => {
      const port = await fakeSmtp({ starttls: '454 not available\r\n' });

      await expect(fetchCertificate({ ...base, port, starttls: 'smtp' })).rejects.toThrow(
        'did not agree to STARTTLS over smtp: 454 not available',
      );
    });

    it('stops when the greeting is not what SMTP should say', async () => {
      const port = await listen(
        createTcpServer((socket) => {
          socket.on('error', () => undefined);
          socket.write('500 go away\r\n');
        }),
      );

      await expect(fetchCertificate({ ...base, port, starttls: 'smtp' })).rejects.toThrow(
        'did not agree to STARTTLS',
      );
    });
  });
});
