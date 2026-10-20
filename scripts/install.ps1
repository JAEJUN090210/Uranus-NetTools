# Installs unt, the Uranus-NetTools command-line network toolkit, on Windows.
#
#   irm https://jaejun090210.github.io/Uranus-NetTools/install.ps1 | iex
#
# Settings (environment variables):
#   UNT_VERSION         version to install, such as 1.0.1 (default: the latest release)
#   UNT_INSTALL_DIR     folder for unt.exe (default: %LOCALAPPDATA%\Programs\unt)
#   UNT_NO_MODIFY_PATH  set to 1 to leave the user PATH alone
#   UNT_DOWNLOAD_URL    folder to download the release files from instead of GitHub (for testing)
#
# Works in Windows PowerShell 5.1 and PowerShell 7. Everything runs in one script block, so iex
# leaves no variables behind in your session, and failures throw instead of calling exit, which
# would close the window.

& {
  $ErrorActionPreference = 'Stop'
  # Windows PowerShell 5.1 redraws its progress bar for every chunk, which slows downloads a lot.
  $ProgressPreference = 'SilentlyContinue'
  # Some Windows PowerShell 5.1 setups still default to TLS 1.0, which GitHub refuses.
  [Net.ServicePointManager]::SecurityProtocol =
    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

  $repository = 'https://github.com/JAEJUN090210/Uranus-NetTools'
  $target = 'windows-x64'

  function Get-Download([string] $Url, [string] $Path) {
    Invoke-WebRequest -Uri $Url -OutFile $Path -UseBasicParsing
  }

  # PATH entries may hold variables such as %LOCALAPPDATA% or end with a backslash.
  function Get-PathEntry([string] $Entry) {
    [Environment]::ExpandEnvironmentVariables($Entry).TrimEnd('\')
  }

  $cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  if ($cpu -eq 'ARM64') {
    Write-Host 'note: installing the x64 build, which Windows 11 on Arm runs through emulation'
  } elseif ($cpu -ne 'AMD64') {
    throw "unsupported CPU $cpu; unt is built for 64-bit Windows"
  }

  if ($env:UNT_INSTALL_DIR) {
    # Resolve a relative folder against the PowerShell location, not the process directory.
    $installDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($env:UNT_INSTALL_DIR).TrimEnd('\')
  } else {
    $installDir = Join-Path $env:LOCALAPPDATA 'Programs\unt'
  }
  $exe = Join-Path $installDir 'unt.exe'

  $requested = "$env:UNT_VERSION".TrimStart('v')
  if ($env:UNT_DOWNLOAD_URL) {
    $base = $env:UNT_DOWNLOAD_URL.TrimEnd('/')
  } elseif ($requested) {
    $base = "$repository/releases/download/v$requested"
  } else {
    $base = "$repository/releases/latest/download"
  }

  $temp = Join-Path ([IO.Path]::GetTempPath()) ('unt-install-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $temp | Out-Null
  try {
    # SHA256SUMS lists every file of the release as "<sha256>  <name>", and the archive name
    # carries the version, so this one small download says what to install and how to check it.
    $sums = Join-Path $temp 'SHA256SUMS'
    try {
      Get-Download "$base/SHA256SUMS" $sums
    } catch {
      if ($requested) {
        throw "version $requested was not found, or the download failed (prebuilt executables start at 1.0.1): $($_.Exception.Message)"
      }
      throw "could not download the release file list from ${base}: $($_.Exception.Message)"
    }
    $suffix = "-$target.zip"
    $entry = $null
    foreach ($line in Get-Content $sums) {
      $fields = $line.Trim() -split '\s+', 2
      if ($fields.Count -ne 2) { continue }
      $name = $fields[1].TrimStart('*')
      if ($name.StartsWith('unt-') -and $name.EndsWith($suffix) -and $name.Length -gt 4 + $suffix.Length) {
        $entry = @{ Hash = $fields[0]; Name = $name }
        break
      }
    }
    if (-not $entry) { throw "this release has no build for $target" }
    $archive = $entry.Name
    $version = $archive.Substring(4, $archive.Length - 4 - $suffix.Length)
    if ($version -notmatch '^\d+\.\d+\.\d+') { throw "unexpected file name $archive in SHA256SUMS" }
    if ($requested -and $requested -ne $version) {
      throw "asked for version $requested but the release holds $version"
    }
    # Download from the release just read, even if a newer one is published in the meantime.
    if (-not $env:UNT_DOWNLOAD_URL) { $base = "$repository/releases/download/v$version" }

    $previous = $null
    if (Test-Path $exe) {
      try { $previous = & $exe --version | Select-Object -First 1 } catch { $previous = $null }
    }
    if (-not $previous) {
      Write-Host "Installing unt $version ($target)"
    } elseif ($previous -eq $version) {
      Write-Host "Reinstalling unt $version ($target)"
    } else {
      Write-Host "Updating unt $previous to $version ($target)"
    }

    $archivePath = Join-Path $temp $archive
    try {
      Get-Download "$base/$archive" $archivePath
    } catch {
      throw "could not download $base/${archive}: $($_.Exception.Message)"
    }
    Write-Host "  downloaded $archive"
    $actual = (Get-FileHash -Algorithm SHA256 -Path $archivePath).Hash
    if ($actual -ne $entry.Hash) {
      throw "checksum mismatch for ${archive}: expected $($entry.Hash), got $actual"
    }
    Write-Host '  checksum OK'

    $unpacked = Join-Path $temp 'unpacked'
    Expand-Archive -Path $archivePath -DestinationPath $unpacked
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null
    # Windows cannot overwrite a running program but can rename it, so move the old one aside.
    $old = "$exe.old"
    Remove-Item -Force $old -ErrorAction SilentlyContinue
    if (Test-Path $exe) { Move-Item -Force $exe $old }
    Move-Item (Join-Path $unpacked 'unt.exe') $exe
    Remove-Item -Force $old -ErrorAction SilentlyContinue
    $installed = & $exe --version | Select-Object -First 1
    if ($installed -ne $version) {
      throw "the installed unt reports version $installed instead of $version"
    }
    Write-Host "  installed $exe"
  } finally {
    Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
  }

  $onPath = @($env:Path -split ';' | Where-Object { $_ -and (Get-PathEntry $_) -eq $installDir }).Count -gt 0
  if ($env:UNT_NO_MODIFY_PATH -ne '1') {
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment')
    try {
      # Read the user PATH as stored, so entries such as %USERPROFILE%\bin stay unexpanded.
      $userPath = [string] $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
      $parts = @($userPath -split ';' | Where-Object { $_ })
      if (-not ($parts | Where-Object { (Get-PathEntry $_) -eq $installDir })) {
        $key.SetValue('Path', (($parts + $installDir) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
        # Setting a variable through .NET tells Explorer and other programs that the environment
        # changed, so terminals opened from now on see the new PATH.
        [Environment]::SetEnvironmentVariable('UNT_INSTALLER', '1', 'User')
        [Environment]::SetEnvironmentVariable('UNT_INSTALLER', $null, 'User')
        Write-Host "  added $installDir to your PATH"
      }
    } finally {
      $key.Close()
    }
    # This window, too.
    if (-not $onPath) { $env:Path = "$env:Path;$installDir" }
    $onPath = $true
  }

  if ($onPath) {
    $found = Get-Command unt -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found -and $found.Path -ne $exe) {
      Write-Host "  note: $($found.Path) comes first on your PATH, so 'unt' still runs that one"
    }
    Write-Host "Run 'unt --help' to get started."
  } else {
    Write-Host "  $installDir is not on your PATH."
    Write-Host "Run '$exe --help' to get started."
  }
}
