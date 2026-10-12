export interface DomainRecord {
  readonly domain: string;
  readonly registrar?: string;
  readonly registrant?: string;
  readonly created?: string;
  readonly updated?: string;
  readonly expires?: string;
  readonly status: readonly string[];
  readonly nameservers: readonly string[];
  readonly dnssec?: boolean;
}

export interface IpRecord {
  readonly start?: string;
  readonly end?: string;
  readonly cidrs: readonly string[];
  readonly name?: string;
  readonly handle?: string;
  readonly type?: string;
  readonly organization?: string;
  readonly country?: string;
  /** 악용 신고를 받는 이메일 주소입니다. */
  readonly abuse?: string;
  readonly created?: string;
  readonly updated?: string;
}

export interface AsnRecord {
  readonly asn: number;
  readonly name?: string;
  readonly handle?: string;
  readonly organization?: string;
  readonly country?: string;
  readonly created?: string;
  readonly updated?: string;
}

export interface Registration<T> {
  readonly source: 'rdap' | 'whois';
  /** 응답한 서버입니다. RDAP은 요청 URL, WHOIS는 서버 이름입니다. */
  readonly server: string;
  readonly record: T;
  /** 서버가 보낸 원본 응답입니다. RDAP은 JSON 객체, WHOIS는 텍스트입니다. */
  readonly raw: unknown;
}
