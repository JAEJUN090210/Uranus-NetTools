import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { connect, createServer, type Server, type Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { createBannerReader, describeBanner } from '../../../src/core/scan/banner';
import { TEST_TLS_CERT, TEST_TLS_KEY } from '../../fixtures/tls';
import { closeServer } from '../../helpers/server';

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

async function serve(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server has no port');
  }
  return address.port;
}

function open(port: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

/** 열린 포트에 연결해 배너를 읽고, 다시 연결한 횟수도 함께 돌려줍니다. */
async function readBanner(port: number) {
  const read = createBannerReader({
    host: '127.0.0.1',
    timeoutMs: 300,
    signal: new AbortController().signal,
  });
  let reconnects = 0;
  const banner = await read(await open(port), port, () => {
    reconnects++;
    return open(port);
  });
  return { banner, reconnects };
}

function respond(_request: IncomingMessage, response: ServerResponse) {
  response.writeHead(200, { server: 'test-server/1.0' });
  response.end();
}

describe('createBannerReader', () => {
  it('reads the greeting a service sends first', async () => {
    const port = await serve(
      createServer((socket) => {
        socket.on('error', () => undefined);
        socket.write('SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5\r\n');
      }),
    );

    expect(await readBanner(port)).toEqual({
      banner: { text: 'SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.5' },
      reconnects: 0,
    });
  });

  it('sends an HTTP request when the service waits for the client', async () => {
    const port = await serve(createHttpServer(respond));

    expect(await readBanner(port)).toEqual({
      banner: { text: 'HTTP/1.1 200 OK · test-server/1.0' },
      reconnects: 0,
    });
  });

  it('retries with TLS when the plain connection gets no answer', async () => {
    const port = await serve(
      createHttpsServer({ key: TEST_TLS_KEY, cert: TEST_TLS_CERT }, respond),
    );

    expect(await readBanner(port)).toEqual({
      banner: { tls: 'TLSv1.3', text: 'HTTP/1.1 200 OK · test-server/1.0' },
      reconnects: 1,
    });
  });

  it('returns nothing for a service that never answers', async () => {
    // 받은 데이터를 읽어 버려야 클라이언트가 연결을 끊은 것을 알아채고 닫힙니다.
    const port = await serve(
      createServer((socket) => {
        socket.on('error', () => undefined);
        socket.resume();
      }),
    );

    expect(await readBanner(port)).toEqual({ banner: undefined, reconnects: 1 });
  });
});

/** MySQL 패킷(길이 3바이트, 순번 1바이트, 본문)을 만듭니다. */
function mysqlPacket(body: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUIntLE(body.length, 0, 3);
  return Buffer.concat([header, body]);
}

describe('describeBanner', () => {
  it.each([
    ['220 mail.example.com ESMTP Postfix\r\n', '220 mail.example.com ESMTP Postfix'],
    ['\r\n\r\n+OK POP3 ready\r\n', '+OK POP3 ready'],
    ['RFB 003.008\n', 'RFB 003.008'],
    ['HTTP/1.0 404 Not Found\r\nContent-Length: 0\r\n\r\n', 'HTTP/1.0 404 Not Found'],
    ['HTTP/1.1 301 Moved\r\nSERVER:  Apache \r\n\r\n', 'HTTP/1.1 301 Moved · Apache'],
    ['\u0000\u0001hello\u0007 world\u001b', 'hello world'],
    ['\r\n\u0000\r\n', undefined],
  ])('%j → %j', (text, banner) => {
    expect(describeBanner(Buffer.from(text, 'latin1'))).toBe(banner);
  });

  it('returns nothing for no data', () => {
    expect(describeBanner(Buffer.alloc(0))).toBeUndefined();
  });

  it('keeps long banners short', () => {
    expect(describeBanner(Buffer.from('x'.repeat(500)))).toHaveLength(200);
  });

  it('reads the server version from a MySQL greeting', () => {
    const greeting = mysqlPacket(
      Buffer.concat([
        Buffer.from([0x0a]),
        Buffer.from('8.0.36\0', 'latin1'),
        Buffer.from([0x08, 0, 0, 0, 0x41, 0x7b, 0x2a, 0x10, 0x0a, 0x33, 0x55, 0x60, 0]),
      ]),
    );

    expect(describeBanner(greeting)).toBe('MySQL 8.0.36');
  });

  it('reads the message from a MySQL error packet', () => {
    const error = mysqlPacket(
      Buffer.concat([
        Buffer.from([0xff, 0x6a, 0x04]),
        Buffer.from("Host '192.0.2.7' is not allowed to connect to this MySQL server", 'utf8'),
      ]),
    );

    expect(describeBanner(error)).toBe(
      "MySQL error 1130: Host '192.0.2.7' is not allowed to connect to this MySQL server",
    );
  });
});
