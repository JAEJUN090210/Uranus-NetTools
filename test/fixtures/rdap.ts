/** 실제 RDAP 서버 응답을 줄인 예시입니다. */

export const verisignDomain = {
  objectClassName: 'domain',
  ldhName: 'GOOGLE.COM',
  status: ['client delete prohibited', 'client transfer prohibited', 'server update prohibited'],
  entities: [
    {
      objectClassName: 'entity',
      roles: ['registrar'],
      publicIds: [{ type: 'IANA Registrar ID', identifier: '292' }],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'MarkMonitor Inc.'],
        ],
      ],
      entities: [
        {
          objectClassName: 'entity',
          roles: ['abuse'],
          vcardArray: [
            'vcard',
            [
              ['version', {}, 'text', '4.0'],
              ['fn', {}, 'text', ''],
              ['email', {}, 'text', 'abusecomplaints@markmonitor.com'],
            ],
          ],
        },
      ],
    },
  ],
  events: [
    { eventAction: 'registration', eventDate: '1997-09-15T04:00:00Z' },
    { eventAction: 'expiration', eventDate: '2028-09-14T04:00:00Z' },
    { eventAction: 'last changed', eventDate: '2019-09-09T15:39:04Z' },
    { eventAction: 'last update of RDAP database', eventDate: '2026-10-12T07:00:00Z' },
  ],
  secureDNS: { delegationSigned: false },
  nameservers: [
    { objectClassName: 'nameserver', ldhName: 'NS1.GOOGLE.COM' },
    { objectClassName: 'nameserver', ldhName: 'NS2.GOOGLE.COM' },
  ],
};

export const arinNetwork = {
  objectClassName: 'ip network',
  handle: 'NET-8-8-8-0-2',
  startAddress: '8.8.8.0',
  endAddress: '8.8.8.255',
  name: 'GOGL',
  type: 'DIRECT ALLOCATION',
  cidr0_cidrs: [{ v4prefix: '8.8.8.0', length: 24 }],
  events: [
    { eventAction: 'registration', eventDate: '2023-12-28T17:24:33-05:00' },
    { eventAction: 'last changed', eventDate: '2023-12-28T17:24:56-05:00' },
  ],
  entities: [
    {
      objectClassName: 'entity',
      roles: ['registrant'],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Google LLC'],
          ['kind', {}, 'text', 'org'],
        ],
      ],
      entities: [
        {
          objectClassName: 'entity',
          roles: ['abuse'],
          vcardArray: [
            'vcard',
            [
              ['version', {}, 'text', '4.0'],
              ['fn', {}, 'text', 'Abuse'],
              ['email', {}, 'text', 'network-abuse@google.com'],
            ],
          ],
        },
      ],
    },
  ],
};

export const apnicNetwork = {
  objectClassName: 'ip network',
  handle: '1.1.1.0 - 1.1.1.255',
  startAddress: '1.1.1.0',
  endAddress: '1.1.1.255',
  name: 'APNIC-LABS',
  type: 'ASSIGNED PORTABLE',
  country: 'AU',
  remarks: [
    {
      title: 'description',
      description: ['APNIC and Cloudflare DNS Resolver project', 'Routed globally by AS13335'],
    },
  ],
  entities: [
    {
      roles: ['abuse'],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'IRT-APNICRANDNET-AU'],
          ['email', {}, 'text', 'helpdesk@apnic.net'],
        ],
      ],
    },
    {
      roles: ['administrative', 'technical'],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'APNIC RESEARCH'],
        ],
      ],
    },
  ],
  cidr0_cidrs: [{ v4prefix: '1.1.1.0', length: 24 }],
};

export const arinAutnum = {
  objectClassName: 'autnum',
  handle: 'AS15169',
  startAutnum: 15169,
  endAutnum: 15169,
  name: 'GOOGLE',
  events: [{ eventAction: 'registration', eventDate: '2000-03-30T00:00:00-05:00' }],
  entities: [
    {
      roles: ['registrant'],
      vcardArray: [
        'vcard',
        [
          ['version', {}, 'text', '4.0'],
          ['fn', {}, 'text', 'Google LLC'],
        ],
      ],
    },
  ],
};
