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
$ unt trace google.com --watch  # keep measuring every hop, like mtr (Ctrl+C to stop)
$ unt trace google.com -c 20    # measure 20 rounds, then print the table
```

| Option | Description |
| --- | --- |
| `-m, --max-hops <n>` | Maximum number of hops (default: 30) |
| `-W, --timeout <ms>` | Time to wait for each reply (default: 2000) |
| `-n, --numeric` | Show IP addresses only, without looking up host names |
| `-4, --ipv4` / `-6, --ipv6` | Use IPv4 or IPv6 only |
| `--watch` | Keep measuring every hop and update the table live |
| `-c, --count <rounds>` | Rounds to measure in watch mode, implies `--watch` |
| `-i, --interval <seconds>` | Seconds between rounds in watch mode (default: 1), implies `--watch` |

Each hop is printed as soon as it finishes. The exit code is 1 when the host is not reached.

With `--watch`, the route is found once and then every hop is pinged each round, the way Windows' `pathping` works, and the table shows loss, last, average, best and worst times per hop. Routers often answer pings slowly or not at all while still forwarding traffic, so loss at a middle hop only matters when it carries on to the hops after it.

### scan

Finds the open TCP ports of a host. It opens a full TCP connection to each port (a connect scan), so it needs no admin rights. By default it checks the 1000 ports that [Nmap](https://nmap.org) scans by default, 500 at a time.

```console
$ unt scan 192.168.0.1                # the 1000 most common ports
$ unt scan 192.168.0.1 -p 22,80,443   # only these ports
$ unt scan 192.168.0.1 -p 1-1024      # a range
$ unt scan 192.168.0.1 -p -           # every port (1-65535)
$ unt scan 192.168.0.1 --banner       # also show what each service says about itself
$ unt scan 192.168.0.1 --all          # also list the closed and filtered ports
```

| Option | Description |
| --- | --- |
| `-p, --ports <list>` | Ports to scan, such as `22,80,443`, `1-1024` or `-` for all (default: the 1000 most common ports) |
| `-a, --all` | Show closed and filtered ports too |
| `-b, --banner` | Read what each open port says about itself |
| `-y, --yes` | Scan a public address without asking |
| `-W, --timeout <ms>` | Time to wait for each port (default: 1500) |
| `--concurrency <n>` | Ports to try at the same time (default: 500) |
| `-4, --ipv4` / `-6, --ipv6` | Use IPv4 or IPv6 only |

A port is **open** when it accepts the connection, **closed** when the host refuses it, and **filtered** when nothing answers in time, usually because a firewall drops the connection. The table lists the open ports and the summary counts the rest. Press Ctrl+C to stop early and see what was found so far.

With `--banner`, `scan` waits for the greeting that services such as SSH, FTP and SMTP send first. If there is none, it sends an HTTP `HEAD` request and shows the status line and the `Server` header. It also tries TLS, so HTTPS on unusual ports shows up with its TLS version, and MySQL servers show their version.

Scanning a public address (anything outside the private, loopback and other reserved ranges) asks for confirmation first, because the host may belong to someone else. Pass `--yes` to skip the question in scripts; without a terminal to ask, `scan` refuses public addresses unless `--yes` is given. See [Responsible use](#responsible-use).

The default port list is the one Nmap uses for `--top-ports 1000`, computed from the frequency data in Nmap's `nmap-services`. Service names come from the [IANA port registry](https://www.iana.org/assignments/service-names-port-numbers/).

### sweep

Finds the active hosts on a local network. It pings each address (ICMP), tries a few common TCP ports for hosts that do not answer pings, and reads the operating system's ARP table to pick up hosts that stay silent but are still present. It needs no admin rights.

```console
$ unt sweep                      # the subnet this computer is on
$ unt sweep 192.168.0.0/24       # a specific network
$ unt sweep 192.168.0.1-50       # a range
$ unt sweep 10.0.0.0/24 --no-hostnames   # skip name lookups, faster
```

| Option | Description |
| --- | --- |
| `-W, --timeout <ms>` | Time to wait for each probe (default: 1000) |
| `--concurrency <n>` | Hosts to probe at the same time (default: 64) |
| `--no-hostnames` | Do not look up host names (faster) |
| `-y, --yes` | Sweep a public range without asking |

Run without a range to sweep the subnet this computer is on. Give a CIDR block (`192.168.0.0/24`), a range (`192.168.0.1-50` or `192.168.0.1-192.168.0.50`) or a single address. A sweep covers up to 65,536 addresses (a `/16`); split larger networks into several runs.

Each host is shown with its name, MAC address, vendor and response time. Host names come from reverse DNS, NetBIOS (mostly Windows PCs) and mDNS (`.local` names used by Apple devices, printers and the like), whichever answers first. The MAC address and vendor are read from the ARP table, so they appear only for hosts on the same LAN; the vendor is looked up from the [IEEE OUI registry](https://standards.ieee.org/products-programs/regauth/), which is bundled, so it works offline. Devices that use a random (privacy) MAC address have no vendor.

Sweeping a public range (anything outside the private, loopback and other reserved ranges) asks for confirmation first, because the hosts may belong to someone else. Pass `--yes` to skip the question in scripts; without a terminal to ask, `sweep` refuses public ranges unless `--yes` is given. See [Responsible use](#responsible-use). Press Ctrl+C to stop early and see what was found so far.

### dns

Looks up the DNS records of a domain. Without `--type` it asks for the records people usually want (A, AAAA, CNAME, MX, NS, TXT, SOA and CAA) at once and shows each one with its TTL. Give it an IP address to do a reverse (PTR) lookup.

```console
$ unt dns example.com                  # the main records
$ unt dns example.com -t MX -t TXT     # only these types
$ unt dns 8.8.8.8                      # reverse lookup
$ unt dns example.com --server 9.9.9.9 # ask a specific server
$ unt dns example.com --compare        # compare several servers
$ unt dns example.com --trace          # follow the delegation from the root
```

| Option | Description |
| --- | --- |
| `-t, --type <types...>` | Record types to ask for (default: the main records) |
| `-s, --server <address>` | IP address of the DNS server to ask instead of the system one |
| `--compare` | Compare the answers of the system and public DNS servers |
| `--trace` | Follow the delegation from the root servers down |
| `-W, --timeout <ms>` | Time to wait for each query (default: 3000) |

Queries go to the system's DNS server over UDP, and fall back to TCP automatically when an answer is too big to fit in one UDP packet. When the system has no usable DNS server (this happens with some VPNs on Windows, where only `127.0.0.1` is configured), the lookups go over HTTPS to a public DNS-over-HTTPS resolver instead. The exit code is 1 when no records are found.

`--compare` asks the system server and [Cloudflare](https://1.1.1.1), [Google](https://developers.google.com/speed/public-dns) and [Quad9](https://www.quad9.net) the same question and puts the answers side by side, which is the quickest way to see whether a change has propagated yet. Servers that do not answer are reported separately and left out of the comparison. The exit code is 1 when the servers that answered disagree.

`--trace` starts at the root servers and follows each delegation down to the authoritative server, the way `dig +trace` does, showing the name servers and timing of every step. It asks the root and authoritative servers directly over UDP port 53, so it does not work on networks that block that.

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

Host names and AS numbers are looked up through the system's DNS servers. When those cannot be reached directly (this happens with some VPNs on Windows), the lookups go over HTTPS to public DNS-over-HTTPS resolvers (dns.google, then cloudflare-dns.com) instead, and private addresses are shown without host names.

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

### info

Shows everything about a domain or an IP address at once. For a domain it summarizes the registration (registrar, dates, name servers) and lists every address with its host name, AS number, owner and location. For an IP address it combines the details of `ip` and `geoip`.

```console
$ unt info google.com
$ unt info 8.8.8.8
$ unt info google.com --no-geo   # do not send the addresses to location services
```

| Option | Description |
| --- | --- |
| `-W, --timeout <ms>` | Time to wait for each lookup (default: 10000) |
| `--no-geo` | Skip locations |
| `-4, --ipv4` / `-6, --ipv6` | Use only the IPv4 or IPv6 addresses of a domain |

If one of the lookups fails, the rest are still shown with a warning and the exit code is 1.

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
