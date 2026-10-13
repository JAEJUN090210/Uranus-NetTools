import { UserError } from '../../cli/errors';
import { runProcess } from '../process';
import { isCommandNotFound } from '../stream';

export interface Endpoint {
  /** 주소입니다. 모든 주소에서 듣는 경우 0.0.0.0이나 ::입니다. */
  readonly address: string;
  readonly port: number;
}

export interface Connection {
  readonly protocol: 'tcp' | 'udp';
  readonly local: Endpoint;
  /** 수신 대기 중인 소켓에는 상대가 없습니다. */
  readonly remote?: Endpoint;
  /** LISTEN, ESTABLISHED 같은 상태입니다. UDP에는 없습니다. */
  readonly state?: string;
  readonly pid?: number;
}

export interface ListOptions {
  readonly platform: NodeJS.Platform;
  readonly env: NodeJS.ProcessEnv;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly onCommand?: (commandLine: string) => void;
}

/** 수신 대기를 뜻하는 상태 이름입니다. 운영체제마다 조금씩 다릅니다. */
const LISTEN_STATES = new Set(['LISTENING', 'LISTEN']);

export function isListening(connection: Connection): boolean {
  return connection.state !== undefined && LISTEN_STATES.has(connection.state.toUpperCase());
}

/** 실제로 상대와 통신 중인 소켓입니다. TIME_WAIT처럼 정리 중인 것은 포함하지 않습니다. */
export function isEstablished(connection: Connection): boolean {
  return connection.state?.toUpperCase() === 'ESTABLISHED';
}

/**
 * 운영체제의 명령으로 소켓 목록을 읽습니다. Node는 이 정보를 알려주지 않습니다.
 * 출력의 설명 부분은 번역될 수 있으므로 주소와 숫자 위치만 보고 해석합니다.
 */
export async function listConnections(options: ListOptions): Promise<Connection[]> {
  const attempts: readonly (readonly [
    string,
    readonly string[],
    (output: string) => Connection[],
  ])[] =
    options.platform === 'win32'
      ? [['netstat', ['-ano'], parseWindows]]
      : options.platform === 'darwin'
        ? [['netstat', ['-an'], parseBsd]]
        : [
            ['ss', ['-tuanp'], parseSs],
            ['netstat', ['-tuanp'], parseLinuxNetstat],
          ];

  let lastError: Error | undefined;
  for (const [file, args, parse] of attempts) {
    options.onCommand?.(`${file} ${args.join(' ')}`);
    try {
      const { stdout } = await runProcess(file, args, {
        timeout: options.timeoutMs,
        signal: options.signal,
        env: options.env,
      });
      const connections = parse(stdout);
      // macOS의 netstat은 프로세스 번호를 믿을 수 있게 주지 않아 lsof로 채웁니다.
      return options.platform === 'darwin' ? await addOwners(connections, options) : connections;
    } catch (error) {
      if (!isCommandNotFound(error)) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw (
    lastError ?? new UserError('this system has no command I know for listing network connections')
  );
}

/**
 * "주소:포트" 를 나눕니다. IPv6은 [::1]:80 또는 ::1.80(BSD) 형식이고,
 * 포트가 *이면 정해지지 않은 것이라 없다고 봅니다.
 */
export function parseEndpoint(text: string): Endpoint | undefined {
  const bracketed = /^\[(.*)]:(\d+|\*)$/.exec(text);
  if (bracketed) {
    return toEndpoint(bracketed[1] ?? '', bracketed[2] ?? '');
  }
  // 마지막 구분자(: 또는 .) 뒤가 포트입니다. BSD는 점으로 구분합니다.
  const separator = Math.max(text.lastIndexOf(':'), text.lastIndexOf('.'));
  if (separator <= 0) {
    return undefined;
  }
  return toEndpoint(text.slice(0, separator), text.slice(separator + 1));
}

function toEndpoint(address: string, port: string): Endpoint | undefined {
  if (!/^\d+$/.test(port)) {
    return undefined;
  }
  // BSD는 모든 주소를 *로, 존이 붙은 IPv6은 %eth0을 뒤에 붙입니다.
  const cleaned = address.replace(/%.*$/, '');
  return { address: cleaned === '*' ? '0.0.0.0' : cleaned, port: Number(port) };
}

/** Windows netstat -ano: "  TCP  0.0.0.0:135  0.0.0.0:0  LISTENING  2044" (UDP는 상태가 없음) */
export function parseWindows(output: string): Connection[] {
  const connections: Connection[] = [];
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const protocol = fields[0]?.toLowerCase();
    if (protocol !== 'tcp' && protocol !== 'udp') {
      continue;
    }
    const local = parseEndpoint(fields[1] ?? '');
    if (local === undefined) {
      continue;
    }
    const remote = parseEndpoint(fields[2] ?? '');
    // TCP는 5열(상태 포함), UDP는 4열입니다.
    const state = protocol === 'tcp' ? fields[3] : undefined;
    const pid = Number(fields.at(-1));
    connections.push({
      protocol,
      local,
      ...(remote === undefined || remote.port === 0 ? {} : { remote }),
      ...(state === undefined ? {} : { state }),
      // 0은 소유 프로세스가 없다는 뜻이라 번호로 보여주지 않습니다.
      ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}),
    });
  }
  return connections;
}

/** ss -tuanp: "tcp LISTEN 0 128 0.0.0.0:22 0.0.0.0:* users:(("sshd",pid=800,fd=3))" */
export function parseSs(output: string): Connection[] {
  const connections: Connection[] = [];
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const protocol = fields[0]?.toLowerCase();
    if ((protocol !== 'tcp' && protocol !== 'udp') || fields.length < 5) {
      continue;
    }
    const local = parseEndpoint(fields[4] ?? '');
    if (local === undefined) {
      continue;
    }
    const remote = parseEndpoint(fields[5] ?? '');
    const pid = /\bpid=(\d+)/.exec(line)?.[1];
    const state = fields[1];
    connections.push({
      protocol,
      local,
      ...(remote === undefined || remote.port === 0 ? {} : { remote }),
      // UDP 소켓의 상태는 UNCONN으로 나오는데, 이는 상태가 없다는 뜻입니다.
      ...(state === undefined || state === 'UNCONN' ? {} : { state }),
      ...(pid === undefined ? {} : { pid: Number(pid) }),
    });
  }
  return connections;
}

/** netstat -tuanp: "tcp 0 0 0.0.0.0:22 0.0.0.0:* LISTEN 800/sshd" */
export function parseLinuxNetstat(output: string): Connection[] {
  const connections: Connection[] = [];
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const protocol = fields[0]?.toLowerCase().replace(/[46]$/, '');
    if ((protocol !== 'tcp' && protocol !== 'udp') || fields.length < 5) {
      continue;
    }
    const local = parseEndpoint(fields[3] ?? '');
    if (local === undefined) {
      continue;
    }
    const remote = parseEndpoint(fields[4] ?? '');
    const state = protocol === 'tcp' ? fields[5] : undefined;
    const pid = /\s(\d+)\/\S+/.exec(line)?.[1];
    connections.push({
      protocol,
      local,
      ...(remote === undefined || remote.port === 0 ? {} : { remote }),
      ...(state === undefined ? {} : { state }),
      ...(pid === undefined ? {} : { pid: Number(pid) }),
    });
  }
  return connections;
}

/** macOS netstat -anv: "tcp4 0 0 127.0.0.1.49152 *.* LISTEN ... 1234" (열 수가 버전마다 다름) */
export function parseBsd(output: string): Connection[] {
  const connections: Connection[] = [];
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const protocol = fields[0]?.toLowerCase().replace(/[46]$/, '');
    if ((protocol !== 'tcp' && protocol !== 'udp') || fields.length < 5) {
      continue;
    }
    const local = parseEndpoint(fields[3] ?? '');
    if (local === undefined) {
      continue;
    }
    const remote = parseEndpoint(fields[4] ?? '');
    const state =
      /\b(LISTEN|ESTABLISHED|SYN_SENT|CLOSE_WAIT|TIME_WAIT|FIN_WAIT_[12]|CLOSING|LAST_ACK|SYN_RCVD)\b/.exec(
        line,
      )?.[1];
    connections.push({
      protocol,
      local,
      ...(remote === undefined || remote.port === 0 ? {} : { remote }),
      ...(state === undefined ? {} : { state }),
    });
  }
  return connections;
}

/** 소켓을 프로토콜과 내 주소로 가리키는 키입니다. lsof 결과와 맞출 때 씁니다. */
export function socketKey(protocol: string, local: Endpoint): string {
  return `${protocol} ${local.address} ${local.port}`;
}

export interface Owner {
  readonly pid: number;
  readonly command: string;
}

/**
 * lsof -nP -i 출력에서 소켓의 소유 프로세스를 읽습니다.
 * NAME 열은 "*:22" 또는 "127.0.0.1:50693->127.0.0.1:50694" 형식입니다.
 */
export function parseLsof(output: string): Map<string, Owner> {
  const owners = new Map<string, Owner>();
  for (const line of output.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const [command, pid] = fields;
    const protocol = fields.find((field) => /^(TCP|UDP)$/.test(field))?.toLowerCase();
    const name = fields.at(-1)?.startsWith('(') === true ? fields.at(-2) : fields.at(-1);
    if (command === undefined || !/^\d+$/.test(pid ?? '') || protocol === undefined) {
      continue;
    }
    const local = parseEndpoint((name ?? '').split('->')[0] ?? '');
    if (local !== undefined) {
      owners.set(socketKey(protocol, local), { pid: Number(pid), command });
    }
  }
  return owners;
}

/** lsof를 쓸 수 있으면 소켓마다 소유 프로세스를 채웁니다. 없거나 권한이 모자라면 그대로 둡니다. */
async function addOwners(
  connections: readonly Connection[],
  options: ListOptions,
): Promise<Connection[]> {
  let owners = new Map<string, Owner>();
  options.onCommand?.('lsof -nP -i');
  try {
    const { stdout } = await runProcess('lsof', ['-nP', '-i'], {
      timeout: options.timeoutMs,
      signal: options.signal,
      env: options.env,
    });
    owners = parseLsof(stdout);
  } catch (error) {
    if (!isCommandNotFound(error)) {
      throw error;
    }
  }
  return connections.map((connection) => {
    const owner = owners.get(socketKey(connection.protocol, connection.local));
    return owner === undefined ? connection : { ...connection, pid: owner.pid };
  });
}
