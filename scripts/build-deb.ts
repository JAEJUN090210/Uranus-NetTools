import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import pkg from '../package.json' with { type: 'json' };

// 사용법: npm run build && npm run build:sea && npm run build:deb   (Linux에서만)
// build:sea가 만든 Linux 실행 파일로 dist/release/unt_<버전>_<아키텍처>.deb를 만듭니다.

const ROOT = resolve(import.meta.dirname, '..');
const SEA = join(ROOT, 'dist', 'sea');
const RELEASE = join(ROOT, 'dist', 'release');
const HOMEPAGE = 'https://github.com/JAEJUN090210/Uranus-NetTools';

/** Node의 CPU 이름을 Debian 아키텍처 이름으로 바꿉니다. */
const ARCHITECTURES: Readonly<Record<string, string>> = { x64: 'amd64', arm64: 'arm64' };

if (process.platform !== 'linux') {
  throw new Error('.deb packages can only be built on Linux');
}
const architecture = ARCHITECTURES[process.arch];
if (architecture === undefined) {
  throw new Error(`no Debian architecture for ${process.arch}`);
}

const name = `unt_${pkg.version}_${architecture}`;
const stage = join(ROOT, 'dist', 'deb', name);
const doc = join(stage, 'usr', 'share', 'doc', 'unt');
rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, 'DEBIAN'), { recursive: true });
mkdirSync(join(stage, 'usr', 'bin'), { recursive: true });
mkdirSync(doc, { recursive: true });

const binary = join(stage, 'usr', 'bin', 'unt');
copyFileSync(join(SEA, 'unt'), binary);
chmodSync(binary, 0o755);
// build:sea가 압축 파일에 넣은 것과 같은 고지 파일입니다.
copyFileSync(
  join(SEA, `unt-${pkg.version}-linux-${process.arch}`, 'THIRD-PARTY-NOTICES.txt'),
  join(doc, 'THIRD-PARTY-NOTICES.txt'),
);

// Debian 기계 판독 형식의 저작권 파일입니다. GPL 전문은 Debian 계열에 이미 들어 있습니다.
writeFileSync(
  join(doc, 'copyright'),
  [
    'Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/',
    'Upstream-Name: Uranus-NetTools',
    `Source: ${HOMEPAGE}`,
    '',
    'Files: *',
    `Copyright: 2026 ${pkg.author}`,
    'License: GPL-3+',
    ' This program is free software: you can redistribute it and/or modify',
    ' it under the terms of the GNU General Public License as published by',
    ' the Free Software Foundation, either version 3 of the License, or',
    ' (at your option) any later version.',
    ' .',
    ' On Debian systems, the complete text of the GNU General Public License',
    ' version 3 can be found in "/usr/share/common-licenses/GPL-3".',
    'Comment: The unt executable also contains Node.js and the commander library.',
    ' Their licenses are in /usr/share/doc/unt/THIRD-PARTY-NOTICES.txt.',
    '',
  ].join('\n'),
);

const installedKib = Math.ceil(
  [binary, join(doc, 'copyright'), join(doc, 'THIRD-PARTY-NOTICES.txt')]
    .map((file) => statSync(file).size)
    .reduce((total, size) => total + size, 0) / 1024,
);

// 공식 Node 실행 파일은 glibc 2.28 이상과 C++ 런타임을 씁니다. Ubuntu 20.04 이후에는 기본으로 들어 있습니다.
writeFileSync(
  join(stage, 'DEBIAN', 'control'),
  [
    'Package: unt',
    `Version: ${pkg.version}`,
    `Architecture: ${architecture}`,
    `Maintainer: ${pkg.author} <ssokage090210@naver.com>`,
    `Installed-Size: ${installedKib}`,
    'Depends: libc6 (>= 2.28), libgcc-s1, libstdc++6',
    'Section: net',
    'Priority: optional',
    `Homepage: ${HOMEPAGE}`,
    `Description: ${pkg.description}`,
    ' Uranus-NetTools (unt) puts everyday network diagnostic, scanning and lookup',
    ' tools behind one command: ping, trace, scan, sweep, dns, whois, ip, geoip,',
    ' info, http, cert, local and conns. It needs no administrator rights.',
    '',
  ].join('\n'),
);

mkdirSync(RELEASE, { recursive: true });
const output = join(RELEASE, `${name}.deb`);
execFileSync('dpkg-deb', ['--build', '--root-owner-group', stage, output], { stdio: 'inherit' });
execFileSync('dpkg-deb', ['--info', output], { stdio: 'inherit' });
console.log(output);
