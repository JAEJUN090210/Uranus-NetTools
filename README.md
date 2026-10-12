# Uranus-NetTools

**CLI-based Network Toolkit Powered by Uranus**

English | [한국어](README.ko.md)

[![CI](https://github.com/JAEJUN090210/Uranus-NetTools/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/JAEJUN090210/Uranus-NetTools/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)

Uranus-NetTools (`unt`) is a cross-platform command-line network toolkit. It bundles everyday diagnostic, scanning, and lookup tools behind one consistent interface: run a single command, or drop into an interactive shell. Built with TypeScript on Node.js.

> [!NOTE]
> Uranus-NetTools is in early development and has not been released yet. The commands and options below may change before the first release (v1.0.0).

## Features

| Category | Tools |
| --- | --- |
| **Diagnostics** | Ping (system ICMP or TCP handshake), traceroute, TCP port connectivity check, latency measurement |
| **Scanning** | TCP connect port scan, LAN host discovery (subnet sweep), service banner grabbing |
| **Lookup** | DNS records (A, AAAA, MX, TXT, ...), WHOIS, IP geolocation and ASN, HTTP headers, TLS certificates |
| **Local info** | Network interfaces and addresses, public IP, default gateway, active connections and listening ports |

- **Two ways to run**: one-shot subcommands for scripts and pipes, or an interactive shell with history.
- **Human and machine friendly**: colored tables by default, `--json` for scripting.
- **No admin rights for ping**: uses the system `ping` command or a TCP handshake instead of raw sockets.
- **Cross-platform**: Windows, Linux, and macOS.

## Usage (preview)

```console
$ unt ping google.com
$ unt scan 192.168.0.1 -p 1-1024
$ unt dns example.com --type MX
$ unt local

$ unt
unt> ping 8.8.8.8
unt> exit
```

### Global options

| Option | Description |
| --- | --- |
| `--json` | Print results as JSON for scripts |
| `-q, --quiet` | Print results only, without hints |
| `--verbose` | Print details such as the system commands being run |
| `-V, --version` | Print the version |
| `-h, --help` | Show help |

Colors turn off automatically when the output is not a terminal or the `NO_COLOR` environment variable is set.

## Installation

Uranus-NetTools will be available through the following package managers.

| Platform | Package manager | Status |
| --- | --- | --- |
| Ubuntu | apt | Planned |
| macOS | Homebrew | Planned |
| Windows | winget | Planned |

## Building from source

Until the first release, you can build and run Uranus-NetTools from source. Node.js 22.13 or later is required.

```console
$ git clone https://github.com/JAEJUN090210/Uranus-NetTools.git
$ cd Uranus-NetTools
$ npm install
$ npm run build
$ node dist/unt.cjs --help
```

Run `npm link` after building to use the `unt` command from anywhere.

## Responsible use

Scanning and probing tools can disrupt networks and may violate laws or policies when used against systems you do not control. Only scan hosts and networks you own or have explicit permission to test.

## Contributing

Contributions are welcome. Before opening an issue or a pull request, please read the following guides (written in Korean):

- [CONTRIBUTING.md](CONTRIBUTING.md): workflow, issues and labels, branches, pull requests, versioning
- [COMMIT_CONVENTION.md](COMMIT_CONVENTION.md): commit message format

## License

Copyright (C) 2026 JAEJUN JEON

Uranus-NetTools is free software, licensed under the [GNU General Public License v3.0](LICENSE).
