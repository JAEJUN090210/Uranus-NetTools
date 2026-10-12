import { createServer as createHttpServer } from 'node:http';
import { type AddressInfo, createServer as createTcpServer } from 'node:net';

export interface JsonRoute {
  readonly status?: number;
  readonly body: unknown;
}

/** 경로별로 정해진 JSON을 돌려주는 로컬 HTTP 서버를 엽니다. RDAP 서버를 흉내 낼 때 씁니다. */
export async function serveJson(routes: (base: string) => Record<string, JsonRoute>) {
  let table: Record<string, JsonRoute> = {};
  const server = createHttpServer((request, response) => {
    const route = table[request.url ?? ''];
    response.writeHead(route?.status ?? (route === undefined ? 404 : 200), {
      'content-type': 'application/rdap+json',
    });
    response.end(JSON.stringify(route?.body ?? { errorCode: 404 }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  table = routes(base);
  return {
    base,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          resolve();
        });
      }),
  };
}

/** 질의에 따라 정해진 텍스트로 답하는 로컬 WHOIS 서버를 엽니다. */
export async function serveWhois(answer: (query: string) => string | Uint8Array) {
  const server = createTcpServer((socket) => {
    let received = '';
    socket.on('data', (chunk) => {
      received += chunk.toString();
      if (received.includes('\n')) {
        socket.end(answer(received.trim()));
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}
