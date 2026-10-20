#!/bin/sh
# Installs unt, the Uranus-NetTools command-line network toolkit, on Linux and macOS.
#
#   curl -fsSL https://jaejun090210.github.io/Uranus-NetTools/install.sh | sh
#
# Settings (environment variables):
#   UNT_VERSION         version to install, such as 1.0.1 (default: the latest release)
#   UNT_INSTALL_DIR     folder for the unt executable (default: ~/.local/bin, or /usr/local/bin as root)
#   UNT_NO_MODIFY_PATH  set to 1 to leave PATH and shell startup files alone
#   UNT_DOWNLOAD_URL    folder to download the release files from instead of GitHub (for testing)
#
# Everything runs from main() on the last line, so a download that stops halfway runs nothing.

set -eu

REPOSITORY=https://github.com/JAEJUN090210/Uranus-NetTools

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need() {
  command -v "$1" > /dev/null 2>&1 || die "this installer needs '$1'; install it and try again"
}

# Sets os, arch and target to the names used in the release files (unt-<version>-<target>.tar.gz).
detect_target() {
  case $(uname -s) in
    Linux) os=linux ;;
    Darwin) os=macos ;;
    *) die "unsupported operating system $(uname -s); on Windows, use install.ps1" ;;
  esac
  case $(uname -m) in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) die "unsupported CPU $(uname -m); unt is built for x64 and arm64" ;;
  esac
  # A shell running under Rosetta 2 reports x86_64 on Apple silicon; the native build is faster.
  if [ "$os" = macos ] && [ "$arch" = x64 ] && [ "$(sysctl -n sysctl.proc_translated 2> /dev/null || true)" = 1 ]; then
    arch=arm64
  fi
  if [ "$os" = linux ]; then
    check_glibc
  fi
  target="$os-$arch"
}

# The Node.js runtime inside unt needs glibc 2.28 or later.
check_glibc() {
  libc=$(getconf GNU_LIBC_VERSION 2> /dev/null || true)
  case $libc in
    'glibc '*)
      libc=${libc#glibc }
      major=${libc%%.*}
      minor=${libc#*.}
      minor=${minor%%.*}
      if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 28 ]; }; then
        die "unt needs glibc 2.28 or later, but this system has glibc $libc"
      fi
      ;;
    *)
      if ldd --version 2>&1 | grep -qi musl; then
        die "unt needs glibc; musl-based systems such as Alpine Linux are not supported"
      fi
      ;;
  esac
}

# fetch <url> <file> [progress]: downloads over HTTPS only, unless UNT_DOWNLOAD_URL points elsewhere.
fetch() {
  url=$1
  file=$2
  mode=${3:-}
  set -- --fail --location --show-error --retry 3 --output "$file"
  if [ -z "${UNT_DOWNLOAD_URL:-}" ]; then
    set -- "$@" --proto '=https' --tlsv1.2
  fi
  if [ "$mode" = progress ] && [ -t 2 ]; then
    set -- "$@" --progress-bar
  else
    set -- "$@" --silent
  fi
  curl "$@" "$url"
}

sha256() {
  if command -v sha256sum > /dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  elif command -v shasum > /dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  elif command -v openssl > /dev/null 2>&1; then
    openssl dgst -sha256 -r "$1" | cut -d ' ' -f 1
  else
    die "this installer needs sha256sum, shasum or openssl to check the download"
  fi
}

# Sets path_entry and line: the PATH line for a POSIX shell startup file. It says $HOME rather than
# the expanded path when it can, as people write it by hand.
path_line() {
  case $install_dir in
    "$HOME"/*) path_entry="\$HOME${install_dir#"$HOME"}" ;;
    *) path_entry=$install_dir ;;
  esac
  line="export PATH=\"$path_entry:\$PATH\""
}

# Adds install_dir to PATH for new terminals by appending one line to the shell's startup file.
add_to_path() {
  path_line
  case ${SHELL:-} in
    */zsh) profile="${ZDOTDIR:-$HOME}/.zshrc" ;;
    */bash)
      # Terminals on macOS start login shells, which read .bash_profile instead of .bashrc.
      if [ "$os" = macos ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.bashrc"; fi
      ;;
    */fish)
      profile="${XDG_CONFIG_HOME:-$HOME/.config}/fish/conf.d/unt.fish"
      line="contains -- \"$path_entry\" \$PATH; or set -gx PATH \"$path_entry\" \$PATH"
      ;;
    *) profile="$HOME/.profile" ;;
  esac
  if [ -f "$profile" ] && grep -Fqx -- "$line" "$profile"; then
    say "  $profile already adds $install_dir to PATH"
    return 0
  fi
  if ! { mkdir -p "$(dirname "$profile")" && printf '\n# Added by the Uranus-NetTools installer\n%s\n' "$line" >> "$profile"; } 2> /dev/null; then
    say "  could not update $profile; add this line to your shell's startup file:"
    say "    $line"
    return 1
  fi
  say "  added $install_dir to PATH in $profile"
}

main() {
  need curl
  need tar
  need awk
  need uname
  need mktemp
  [ -n "${HOME:-}" ] || die "HOME is not set"

  detect_target
  if [ -n "${UNT_INSTALL_DIR:-}" ]; then
    install_dir=${UNT_INSTALL_DIR%/}
  elif [ "$(id -u)" = 0 ]; then
    install_dir=/usr/local/bin
  else
    install_dir="$HOME/.local/bin"
  fi

  requested=${UNT_VERSION:-}
  requested=${requested#v}
  if [ -n "${UNT_DOWNLOAD_URL:-}" ]; then
    base=${UNT_DOWNLOAD_URL%/}
  elif [ -n "$requested" ]; then
    base="$REPOSITORY/releases/download/v$requested"
  else
    base="$REPOSITORY/releases/latest/download"
  fi

  tmp=$(mktemp -d) || die "could not create a temporary folder"
  trap 'rm -rf "$tmp"' EXIT
  trap 'exit 1' HUP INT TERM

  # SHA256SUMS lists every file of the release as "<sha256>  <name>", and the archive name carries
  # the version, so this one small download says what to install and how to check it.
  if ! fetch "$base/SHA256SUMS" "$tmp/SHA256SUMS"; then
    if [ -n "$requested" ]; then
      die "version $requested was not found, or the download failed (prebuilt executables start at 1.0.1)"
    fi
    die "could not download the release file list from $base"
  fi
  entry=$(awk -v suffix="-$target.tar.gz" '
    { name = $2; sub(/^\*/, "", name) }
    index(name, "unt-") == 1 && length(name) > length(suffix) &&
      substr(name, length(name) - length(suffix) + 1) == suffix { print $1, name; exit }
  ' "$tmp/SHA256SUMS")
  [ -n "$entry" ] || die "this release has no build for $target"
  expected=${entry%% *}
  archive=${entry#* }
  version=${archive#unt-}
  version=${version%"-$target.tar.gz"}
  case $version in
    [0-9]*.[0-9]*.[0-9]*) ;;
    *) die "unexpected file name $archive in SHA256SUMS" ;;
  esac
  if [ -n "$requested" ] && [ "$requested" != "$version" ]; then
    die "asked for version $requested but the release holds $version"
  fi
  # Download from the release just read, even if a newer one is published in the meantime.
  if [ -z "${UNT_DOWNLOAD_URL:-}" ]; then
    base="$REPOSITORY/releases/download/v$version"
  fi

  previous=
  if [ -x "$install_dir/unt" ]; then
    previous=$("$install_dir/unt" --version 2> /dev/null || true)
  fi
  if [ -z "$previous" ]; then
    say "Installing unt $version ($target)"
  elif [ "$previous" = "$version" ]; then
    say "Reinstalling unt $version ($target)"
  else
    say "Updating unt $previous to $version ($target)"
  fi

  fetch "$base/$archive" "$tmp/$archive" progress || die "could not download $base/$archive"
  say "  downloaded $archive"
  actual=$(sha256 "$tmp/$archive")
  [ "$actual" = "$expected" ] || die "checksum mismatch for $archive: expected $expected, got $actual"
  say "  checksum OK"

  tar -xzf "$tmp/$archive" -C "$tmp" unt || die "could not unpack $archive"
  mkdir -p "$install_dir" 2> /dev/null || die "could not create $install_dir; set UNT_INSTALL_DIR to a folder you can write to"
  # Copy next to the old file and rename over it, so a running unt is replaced safely.
  staged="$install_dir/.unt.$$"
  if ! { cp "$tmp/unt" "$staged" && chmod 755 "$staged" && mv -f "$staged" "$install_dir/unt"; } 2> /dev/null; then
    rm -f "$staged"
    die "could not write to $install_dir; set UNT_INSTALL_DIR to a folder you can write to"
  fi
  installed=$("$install_dir/unt" --version 2> /dev/null) || die "the installed $install_dir/unt does not run on this system"
  [ "$installed" = "$version" ] || die "the installed unt reports version $installed instead of $version"
  say "  installed $install_dir/unt"

  case ":$PATH:" in
    *":$install_dir:"*)
      found=$(command -v unt || true)
      if [ -n "$found" ] && [ "$found" != "$install_dir/unt" ]; then
        say "  note: $found comes first on your PATH, so 'unt' still runs that one"
      fi
      say "Run 'unt --help' to get started."
      ;;
    *)
      if [ "${UNT_NO_MODIFY_PATH:-}" = 1 ]; then
        path_line
        say "  $install_dir is not on your PATH; to add it, put this line in your shell's startup file:"
        say "    $line"
        say "Run '$install_dir/unt --help' to get started."
      elif add_to_path; then
        say "Open a new terminal, then run 'unt --help' to get started."
      else
        say "Run '$install_dir/unt --help' to get started."
      fi
      ;;
  esac
}

main "$@"
