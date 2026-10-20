import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { APT_COMPONENT, APT_KEY_FILE, APT_SUITE } from './lib/pages';

// 사용법: tsx scripts/build-apt-repo.ts   (Linux, apt-utils와 gpg가 있고 서명 키를 gpg에 넣어 둔 상태)
// dist/release의 .deb로 서명된 apt 저장소를 dist/site/apt에 만듭니다. 안내 페이지는 build-site.ts가 씁니다.
// 서명할 키는 APT_GPG_KEY_ID(없으면 gpg 기본 키), 키 암호는 APT_GPG_PASSPHRASE(있을 때만)로 받습니다.

const ROOT = resolve(import.meta.dirname, '..');
const RELEASE = join(ROOT, 'dist', 'release');
const APT = join(ROOT, 'dist', 'site', 'apt');
const SUITE = APT_SUITE;
const COMPONENT = APT_COMPONENT;
const ARCHITECTURES = ['amd64', 'arm64'] as const;
const KEY_FILE = APT_KEY_FILE;

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

rmSync(APT, { recursive: true, force: true });
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

console.log(`apt repository for ${debs.join(', ')} written to ${APT}`);
