import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import pkg from '../package.json' with { type: 'json' };

// 사용법: tsx scripts/build-apt-repo.ts   (Linux, apt-utils와 gpg가 있고 서명 키를 gpg에 넣어 둔 상태)
// dist/release의 .deb로 서명된 apt 저장소와 설치 안내 페이지를 dist/site에 만듭니다.
// 서명할 키는 APT_GPG_KEY_ID(없으면 gpg 기본 키), 키 암호는 APT_GPG_PASSPHRASE(있을 때만)로 받습니다.

const ROOT = resolve(import.meta.dirname, '..');
const RELEASE = join(ROOT, 'dist', 'release');
const SITE = join(ROOT, 'dist', 'site');
const APT = join(SITE, 'apt');
const SUITE = 'stable';
const COMPONENT = 'main';
const ARCHITECTURES = ['amd64', 'arm64'] as const;
const KEY_FILE = 'uranus-nettools.gpg';
const PAGES_URL = 'https://jaejun090210.github.io/Uranus-NetTools';
const REPOSITORY_URL = 'https://github.com/JAEJUN090210/Uranus-NetTools';

const keyId = process.env.APT_GPG_KEY_ID;
const passphrase = process.env.APT_GPG_PASSPHRASE;

function run(file: string, args: readonly string[], cwd = APT): string {
  return execFileSync(file, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

/** 서명 명령입니다. 키 암호는 명령줄에 남지 않도록 표준 입력으로 넘깁니다. */
function sign(args: readonly string[]): void {
  execFileSync(
    'gpg',
    [
      '--batch',
      '--yes',
      ...(keyId === undefined || keyId === '' ? [] : ['--local-user', keyId]),
      ...(passphrase === undefined || passphrase === ''
        ? []
        : ['--pinentry-mode', 'loopback', '--passphrase-fd', '0']),
      ...args,
    ],
    { cwd: APT, input: passphrase ?? '', stdio: ['pipe', 'inherit', 'inherit'] },
  );
}

function exportKey(armor: boolean): Buffer {
  return execFileSync('gpg', [
    '--batch',
    ...(armor ? ['--armor'] : []),
    '--export',
    ...(keyId === undefined || keyId === '' ? [] : [keyId]),
  ]);
}

const debs = readdirSync(RELEASE).filter((file) => file.endsWith('.deb'));
if (debs.length === 0) {
  throw new Error('no .deb files in dist/release; run `npm run build:deb` first');
}

rmSync(SITE, { recursive: true, force: true });
const pool = join(APT, 'pool', COMPONENT, 'u', 'unt');
mkdirSync(pool, { recursive: true });
for (const deb of debs) {
  copyFileSync(join(RELEASE, deb), join(pool, deb));
}

// apt-ftparchive는 저장소 맨 위를 기준으로 경로를 적으므로 APT 디렉터리에서 실행합니다.
const dist = join('dists', SUITE);
for (const architecture of ARCHITECTURES) {
  const directory = join(APT, dist, COMPONENT, `binary-${architecture}`);
  mkdirSync(directory, { recursive: true });
  const packages = run('apt-ftparchive', ['--arch', architecture, 'packages', 'pool']);
  writeFileSync(join(directory, 'Packages'), packages);
  writeFileSync(join(directory, 'Packages.gz'), gzipSync(packages));
}

const release = run('apt-ftparchive', [
  '-o',
  'APT::FTPArchive::Release::Origin=Uranus-NetTools',
  '-o',
  'APT::FTPArchive::Release::Label=Uranus-NetTools',
  '-o',
  `APT::FTPArchive::Release::Suite=${SUITE}`,
  '-o',
  `APT::FTPArchive::Release::Codename=${SUITE}`,
  '-o',
  `APT::FTPArchive::Release::Architectures=${ARCHITECTURES.join(' ')}`,
  '-o',
  `APT::FTPArchive::Release::Components=${COMPONENT}`,
  '-o',
  'APT::FTPArchive::Release::Description=unt, a command-line network toolkit',
  'release',
  dist,
]);
writeFileSync(join(APT, dist, 'Release'), release);

// 새 apt는 InRelease(본문과 서명이 한 파일)를, 오래된 apt는 Release.gpg(따로 떼어 낸 서명)를 읽습니다.
sign(['--clearsign', '--output', join(dist, 'InRelease'), join(dist, 'Release')]);
sign(['--armor', '--detach-sign', '--output', join(dist, 'Release.gpg'), join(dist, 'Release')]);

writeFileSync(join(APT, KEY_FILE), exportKey(false));
writeFileSync(join(APT, KEY_FILE.replace(/\.gpg$/, '.asc')), exportKey(true));

const install = [
  'sudo install -d -m 0755 /etc/apt/keyrings',
  `curl -fsSL ${PAGES_URL}/apt/${KEY_FILE} | sudo tee /etc/apt/keyrings/${KEY_FILE} > /dev/null`,
  `echo "deb [signed-by=/etc/apt/keyrings/${KEY_FILE}] ${PAGES_URL}/apt ${SUITE} ${COMPONENT}" | sudo tee /etc/apt/sources.list.d/uranus-nettools.list`,
  'sudo apt update',
  'sudo apt install unt',
].join('\n');

writeFileSync(
  join(SITE, 'index.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Uranus-NetTools</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1f2328; background: #fff; }
  pre { background: #f6f8fa; padding: 1rem; overflow-x: auto; border-radius: 6px; }
  @media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } pre { background: #161b22; } a { color: #4493f8; } }
</style>
</head>
<body>
<h1>Uranus-NetTools</h1>
<p>apt repository for <code>unt</code> ${pkg.version}, a cross-platform command-line network toolkit.
Source code and documentation are on <a href="${REPOSITORY_URL}">GitHub</a>.</p>
<h2>Install on Ubuntu or Debian (amd64, arm64)</h2>
<pre>${install}</pre>
<p>Later versions arrive with <code>sudo apt upgrade</code>.</p>
</body>
</html>
`,
);

console.log(`apt repository for ${debs.join(', ')} written to ${SITE}`);
