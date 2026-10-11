# Single core installer for Claude/Codex. Local checkout or remote Git source.
[CmdletBinding()]
param(
  [ValidateSet('auto','claude','codex','both')][string]$Runtime = 'auto',
  [string]$Source = '',
  [string]$Repo = $(if ($env:BLINDAR_REPO) { $env:BLINDAR_REPO } else { 'maykonlong/blindar-claude' }),
  [string]$Branch = $(if ($env:BLINDAR_BRANCH) { $env:BLINDAR_BRANCH } else { 'main' }),
  [switch]$Check
)
$ErrorActionPreference = 'Stop'
Get-Command node -ErrorAction Stop | Out-Null
$tempSource = $null
try {
  if (-not $Source -and $PSScriptRoot) {
    $candidate = Split-Path -Parent $PSScriptRoot
    if (Test-Path -LiteralPath (Join-Path $candidate 'SKILL.md')) { $Source = $candidate }
  }
  if (-not $Source) {
    $tempSource = Join-Path ([IO.Path]::GetTempPath()) ('blindar-install-' + [guid]::NewGuid().ToString('N'))
    git clone --branch $Branch --depth 1 "https://github.com/$Repo.git" $tempSource
    if ($LASTEXITCODE -ne 0) { throw 'git clone falhou' }
    $Source = $tempSource
  }
  $arguments = @((Join-Path $Source 'scripts/install-runtime.mjs'), '--source', $Source, '--runtime', $Runtime)
  if ($Check) { $arguments += '--check' }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw "Instalação/verificação falhou (exit $LASTEXITCODE)" }
} finally {
  if ($tempSource -and (Test-Path -LiteralPath $tempSource)) {
    $resolved = [IO.Path]::GetFullPath($tempSource)
    $safeRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
    if (-not $resolved.StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolved) -notlike 'blindar-install-*') { throw 'Limpeza fora do diretório temporário recusada' }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
