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
unt ❯ ping 8.8.8.8
unt ❯ exit
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

### Interactive shell

Run `unt` without arguments to open an interactive shell. Every command works the same way as on the command line.

- `Tab` completes command names and options.
- `help [command]` shows help, `clear` clears the screen, and `exit` or `quit` leaves the shell.
- `Ctrl+C` cancels the running command without leaving the shell. Press it twice on an empty line, or press `Ctrl+D`, to quit.

## Commands

### ping

Checks whether hosts respond and how fast. ICMP uses the system `ping` command, so no admin rights are needed. Where ICMP is blocked, `--tcp` measures the TCP handshake time instead.

```console
$ unt ping google.com                    # 4 probes
$ unt ping google.com -t                 # until Ctrl+C
$ unt ping example.com --tcp             # TCP port 443
$ unt ping example.com -p 22             # TCP port 22
$ unt ping google.com 1.1.1.1 8.8.8.8    # compare hosts in a table
```

| Option | Description |
| --- | --- |
| `-c, --count <n>` | Probes per host (default: 4) |
| `-t, --continuous` | Keep pinging until Ctrl+C |
| `-i, --interval <seconds>` | Seconds between probes (default: 1) |
| `-W, --timeout <ms>` | Time to wait for each reply (default: 2000) |
| `--tcp` | Measure the TCP handshake time instead of ICMP |
| `-p, --port <port>` | TCP port, implies `--tcp` (default: 443) |
| `-4, --ipv4` / `-6, --ipv6` | Use IPv4 or IPv6 only |

The summary shows loss, min/avg/max, jitter, p95 and a sparkline of the response times. The exit code is 1 when a host gets no reply at all.

### trace

Shows each router on the way to a host and how long it takes to reply. It runs the system `tracert` (Windows) or `traceroute` (macOS, Linux), and falls back to `tracepath` on Linux distributions without traceroute.

```console
$ unt trace google.com          # with host names
$ unt trace google.com -n       # IP addresses only, faster
$ unt trace 1.1.1.1 -m 15       # stop after 15 hops
```

| Option | Description |
| --- | --- |
| `-m, --max-hops <n>` | Maximum number of hops (default: 30) |
| `-W, --timeout <ms>` | Time to wait for each reply (default: 2000) |
| `-n, --numeric` | Show IP addresses only, without looking up host names |
| `-4, --ipv4` / `-6, --ipv6` | Use IPv4 or IPv6 only |

Each hop is printed as soon as it finishes. The exit code is 1 when the host is not reached.

### whois

Looks up who registered a domain, an IP address block or an AS number, and when. It asks the registry's RDAP server first and falls back to classic WHOIS (port 43) for country domains that do not offer RDAP yet.

```console
$ unt whois google.com                   # registrar, dates, status, name servers
$ unt whois https://www.naver.co.kr/     # URLs and subdomains work too
$ unt whois 8.8.8.8                      # network owner and abuse contact
$ unt whois AS15169                      # owner of an AS number
$ unt whois example.com --raw            # the server's original response
```

| Option | Description |
| --- | --- |
| `-W, --timeout <ms>` | Time to wait for each server (default: 10000) |
| `--raw` | Print the server's original response |

### ip

Shows which network an IP address belongs to: its host name (reverse DNS), the AS number and BGP prefix that announce it (from [Team Cymru](https://www.team-cymru.com/ip-asn-mapping)), and the registered owner and abuse contact (RDAP). Give it a domain to see every IPv4 and IPv6 address of that domain in a table. It does not look up locations.

```console
$ unt ip 8.8.8.8          # details of one address
$ unt ip google.com       # every address of a domain
$ unt ip google.com -6    # only the IPv6 addresses
```

| Option | Description |
| --- | --- |
| `-W, --timeout <ms>` | Time to wait for each lookup (default: 10000) |
| `-4, --ipv4` / `-6, --ipv6` | Use only the IPv4 or IPv6 addresses of a domain |

Private and reserved addresses are never sent to outside services. If one of the lookups fails, the others are still shown with a warning and the exit code is 1.

Host names and AS numbers are looked up through the system's DNS servers. When those cannot be reached directly (this happens with some VPNs on Windows), the lookups go through public resolvers (8.8.8.8, 1.1.1.1) instead, and private addresses are shown without host names.

### geoip

Shows the approximate location of an IP address: country, region, city, coordinates with an OpenStreetMap link, time zone, network and whether it is a known proxy or VPN. Give it a domain to see every address of that domain in a table.

```console
$ unt geoip 8.8.8.8
$ unt geoip google.com
```

| Option | Description |
| --- | --- |
| `-W, --timeout <ms>` | Time to wait for each lookup (default: 10000) |
| `-4, --ipv4` / `-6, --ipv6` | Use only the IPv4 or IPv6 addresses of a domain |

Locations come from [FreeIPAPI](https://freeipapi.com), with [GeoJS](https://www.geojs.io) as a fallback. Both are free, need no API key and allow commercial use. To look up an address, `geoip` sends it to these services; private and reserved addresses are never sent. Locations are estimates and can differ between services.

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
