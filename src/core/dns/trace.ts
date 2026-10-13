import { UserError } from '../../cli/errors';
import { query, type QuerySettings } from './client';
import { RECORD_TYPES, type ResourceRecord } from './wire';

/**
 * 루트 서버 주소입니다. (https://www.iana.org/domains/root/servers)
 * 위임을 따라가려면 처음 물어볼 곳이 필요하고, 이 주소는 거의 바뀌지 않습니다.
 */
export const ROOT_SERVERS: readonly { readonly name: string; readonly address: string }[] = [
  { name: 'a.root-servers.net', address: '198.41.0.4' },
  { name: 'b.root-servers.net', address: '170.247.170.2' },
  { name: 'c.root-servers.net', address: '192.33.4.12' },
  { name: 'd.root-servers.net', address: '199.7.91.13' },
  { name: 'e.root-servers.net', address: '192.203.230.10' },
  { name: 'f.root-servers.net', address: '192.5.5.241' },
  { name: 'g.root-servers.net', address: '192.112.36.4' },
  { name: 'h.root-servers.net', address: '198.97.190.53' },
  { name: 'i.root-servers.net', address: '192.36.148.17' },
  { name: 'j.root-servers.net', address: '192.58.128.30' },
  { name: 'k.root-servers.net', address: '193.0.14.129' },
  { name: 'l.root-servers.net', address: '199.7.83.42' },
  { name: 'm.root-servers.net', address: '202.12.27.33' },
];

/** 위임을 따라가는 한 단계입니다. */
export interface TraceStep {
  /** 이 단계에서 물어본 서버입니다. */
  readonly server: string;
  readonly serverName?: string;
  /** 응답이 책임지는 영역입니다. 루트는 "." 입니다. */
  readonly zone: string;
  readonly elapsed: number;
  /** 다음에 물어볼 서버들의 이름입니다. */
  readonly nameservers: readonly string[];
  /** 권한 있는 응답을 받았으면 그 레코드입니다. */
  readonly answers?: readonly ResourceRecord[];
}

export interface TraceOptions extends QuerySettings {
  /** 한 단계가 끝날 때마다 알려 줍니다. */
  readonly onStep?: (step: TraceStep) => void;
  readonly roots?: readonly { readonly name: string; readonly address: string }[];
  /** 이름을 주소로 바꿉니다. 글루 레코드가 없는 위임을 따라갈 때 씁니다. */
  readonly resolveNameserver?: (name: string) => Promise<string | undefined>;
}

const MAX_STEPS = 16;

/**
 * 루트 서버부터 시작해 위임(NS)을 따라가며 권한 있는 서버까지 내려갑니다. dig +trace와 같은 방식입니다.
 * 각 단계는 재귀를 요청하지 않으므로(RD=0) 서버는 자기가 아는 위임만 알려 줍니다.
 */
export async function traceDelegation(
  name: string,
  type: number,
  options: TraceOptions,
): Promise<TraceStep[]> {
  const roots = options.roots ?? ROOT_SERVERS;
  const [root] = roots;
  if (root === undefined) {
    throw new UserError('no root servers to start from');
  }

  const steps: TraceStep[] = [];
  let current: { address: string; name?: string } = { address: root.address, name: root.name };
  const settings: QuerySettings = { ...options, recursionDesired: false };

  for (let depth = 0; depth < MAX_STEPS; depth++) {
    const { message, elapsed } = await query(current.address, name, type, settings);
    const nameservers = message.authorities.filter((record) => record.type === RECORD_TYPES.NS);
    const zone = nameservers[0]?.name ?? message.question?.name ?? name;
    const step: TraceStep = {
      server: current.address,
      ...(current.name === undefined ? {} : { serverName: current.name }),
      zone: zone === '' ? '.' : zone,
      elapsed,
      nameservers: nameservers.map((record) => record.data),
      ...(message.answers.length > 0 ? { answers: message.answers } : {}),
    };
    steps.push(step);
    options.onStep?.(step);

    // 답을 받았거나 더 내려갈 위임이 없으면 끝입니다.
    if (message.answers.length > 0 || nameservers.length === 0) {
      return steps;
    }

    const next = await pickNameserver(nameservers, message.additionals, options);
    if (next === undefined) {
      throw new UserError(`could not find an address for the ${step.zone} name servers`);
    }
    current = next;
  }
  throw new UserError(`the delegation for ${name} goes deeper than ${MAX_STEPS} steps`);
}

/** 위임받은 서버 중 하나를 고릅니다. 응답에 주소(글루)가 있으면 그것을 쓰고, 없으면 이름을 따로 조회합니다. */
async function pickNameserver(
  nameservers: readonly ResourceRecord[],
  additionals: readonly ResourceRecord[],
  options: TraceOptions,
): Promise<{ address: string; name: string } | undefined> {
  const glue = new Map<string, string>();
  for (const record of additionals) {
    if (record.type === RECORD_TYPES.A && !glue.has(record.name)) {
      glue.set(record.name.toLowerCase(), record.data);
    }
  }
  for (const record of nameservers) {
    const address = glue.get(record.data.toLowerCase());
    if (address !== undefined) {
      return { address, name: record.data };
    }
  }
  // 글루가 없으면(위임이 다른 영역의 이름을 쓰는 경우) 이름을 주소로 바꿔 봅니다.
  for (const record of nameservers) {
    const address = await options.resolveNameserver?.(record.data);
    if (address !== undefined) {
      return { address, name: record.data };
    }
  }
  return undefined;
}
