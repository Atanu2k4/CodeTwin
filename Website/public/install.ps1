# CodeTwin installer for Windows PowerShell.
# Usage: irm https://code-twin.vercel.app/install.ps1 | iex

$ErrorActionPreference = 'Stop'

$repoUrl = if ($env:CODETWIN_REPO_URL) { $env:CODETWIN_REPO_URL } else { 'https://github.com/Sahnik0/CodeTwin.git' }
$repoBranch = if ($env:CODETWIN_BRANCH) { $env:CODETWIN_BRANCH } else { 'main' }
$installHome = if ($env:CODETWIN_HOME) { $env:CODETWIN_HOME } else { Join-Path $HOME '.codetwin' }
$repoDir = Join-Path $installHome 'repo'
$binDir = Join-Path $HOME '.local\bin'
$launcherPath = Join-Path $binDir 'codetwin.cmd'
$noPathUpdate = if ($env:CODETWIN_NO_PATH_UPDATE -eq '1') { $true } else { $false }

function Fail([string]$message) {
  Write-Error $message
  exit 1
}

function Require-Command([string]$name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Fail "Required command not found: $name"
  }
}

function Ensure-UserPath([string]$pathToAdd) {
  $current = [Environment]::GetEnvironmentVariable('Path', 'User')
  if ([string]::IsNullOrWhiteSpace($current)) {
    [Environment]::SetEnvironmentVariable('Path', $pathToAdd, 'User')
    $env:Path = "$pathToAdd;$env:Path"
    Write-Host "Updated user PATH with $pathToAdd"
    return
  }

  $parts = $current.Split(';') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  if ($parts -contains $pathToAdd) {
    return
  }

  $next = "$current;$pathToAdd"
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
  $env:Path = "$pathToAdd;$env:Path"
  Write-Host "Updated user PATH with $pathToAdd"
}

Require-Command git
Require-Command bun

Write-Host "Installing CodeTwin from $repoUrl ($repoBranch)..."
New-Item -ItemType Directory -Path $installHome -Force | Out-Null

if (Test-Path (Join-Path $repoDir '.git')) {
  Write-Host 'Existing install found, updating...'
  git -C $repoDir fetch --depth=1 origin $repoBranch
  git -C $repoDir checkout -B $repoBranch "origin/$repoBranch"
} else {
  Write-Host 'Cloning repository...'
  git clone --depth=1 --branch $repoBranch $repoUrl $repoDir
}

Write-Host 'Installing CLI dependencies (this may take a minute)...'
bun install --cwd (Join-Path $repoDir 'CLI\codetwin-cli')

New-Item -ItemType Directory -Path $binDir -Force | Out-Null
$launcherContent = @"
@echo off
setlocal
set "ROOT=%USERPROFILE%\.codetwin\repo"
call "%ROOT%\CLI\codetwin.cmd" %*
"@
Set-Content -Path $launcherPath -Value $launcherContent -Encoding Ascii

if (-not $noPathUpdate) {
  Ensure-UserPath $binDir
}

Write-Host ''
Write-Host 'CodeTwin installed successfully.'
Write-Host ''
Write-Host 'Next steps:'
Write-Host '  1) Open a new PowerShell terminal.'
Write-Host '  2) Run: codetwin --help'
Write-Host '  3) Start TUI: codetwin'
Write-Host '  4) Optional remote: codetwin login https://codetwin-1quv.onrender.com && codetwin worker'
