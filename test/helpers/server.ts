import { createServer, type Server } from 'node:net';

/** 127.0.0.1의 빈 포트에서 연결만 받아 주는 TCP 서버를 엽니다. */
export async function listenLocally(): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('the test server has no port');
  }
  return { server, port: address.port };
}

export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

/** 방금까지 열려 있다가 닫힌, 연결을 거부하는 포트 번호를 돌려줍니다. */
export async function closedPort(): Promise<number> {
  const { server, port } = await listenLocally();
  await closeServer(server);
  return port;
}
