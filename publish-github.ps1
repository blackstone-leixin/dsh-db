#Requires -Version 5.1
[CmdletBinding()]
param(
  [string]$RepoName = 'dsh-db',
  [ValidateSet('public', 'private')][string]$Visibility = 'public',
  [string]$Description = 'DeepSeek Harness database plugin: MySQL/PostgreSQL connections, schema tree, table search, SQL console, agent tools.',
  [string]$RemoteUrl = ''
)

# Publish this plugin to a new GitHub repository.
# Run from the plugin directory:  .\publish-github.ps1 -Visibility public
# Requires git. If GitHub CLI (gh) is installed and authenticated, the repo is
# created automatically. Otherwise the script walks through github.com/new and
# pushes to the URL you paste.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

function Stop-WithMessage([string]$Message) {
  Write-Host $Message -ForegroundColor Red
  exit 1
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Stop-WithMessage @'
Git was not found. Install it first: https://git-scm.com/download/win
Then reopen the terminal and run this script again.
'@
}

$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $package.version

if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
  Write-Host 'Initializing git repository...'
  git init
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'git init failed.' }
  git symbolic-ref HEAD refs/heads/main
}

$branch = git branch --show-current
if ([string]::IsNullOrWhiteSpace($branch)) {
  git symbolic-ref HEAD refs/heads/main
  $branch = 'main'
}

$userName = git config user.name
if ([string]::IsNullOrWhiteSpace($userName)) {
  $userName = Read-Host 'Git user.name (your GitHub name)'
  if ([string]::IsNullOrWhiteSpace($userName)) { Stop-WithMessage 'user.name is required.' }
  git config user.name $userName
}
$userEmail = git config user.email
if ([string]::IsNullOrWhiteSpace($userEmail)) {
  $userEmail = Read-Host 'Git user.email (GitHub email or noreply address)'
  if ([string]::IsNullOrWhiteSpace($userEmail)) { Stop-WithMessage 'user.email is required.' }
  git config user.email $userEmail
}

Write-Host 'Staging files...'
git add -A
$pending = @(git status --porcelain)
if ($pending.Count -gt 0) {
  $hasHead = Test-Path -LiteralPath (Join-Path $root ".git\refs\heads\$branch")
  $message = if ($hasHead) { "Update dsh-db $version" } else { "Initial commit: dsh-db $version" }
  Write-Host "git commit -m `"$message`""
  git commit -m $message
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'git commit failed.' }
} else {
  Write-Host 'No changes to commit.'
}

$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($null -ne $gh) {
  gh auth status *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'GitHub CLI is not signed in; starting gh auth login...'
    gh auth login
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'gh auth login failed.' }
  }

  gh repo view $RepoName *> $null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "GitHub repository '$RepoName' already exists; pushing..."
    $remotes = @(git remote)
    if (-not ($remotes -contains 'origin')) {
      $repoUrl = (gh repo view $RepoName --json url --jq .url).Trim()
      if ([string]::IsNullOrWhiteSpace($repoUrl)) { Stop-WithMessage 'Could not read the repository URL.' }
      git remote add origin $repoUrl
    }
    git push -u origin $branch
    if ($LASTEXITCODE -ne 0) { Stop-WithMessage 'git push failed (check origin and auth).' }
    gh repo view $RepoName --web
    exit 0
  }

  Write-Host "Creating GitHub repository '$RepoName' ($Visibility)..."
  gh repo create $RepoName "--$Visibility" --source . --remote origin --push --description $Description
  if ($LASTEXITCODE -eq 0) {
    $url = (gh repo view $RepoName --json url --jq .url).Trim()
    Write-Host "Published: $url" -ForegroundColor Green
    gh repo view $RepoName --web
    exit 0
  }
  Write-Host 'gh repo create failed; falling back to a manual push.' -ForegroundColor Yellow
} else {
  Write-Host 'GitHub CLI (gh) was not found; falling back to a manual push.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Manual steps:' -ForegroundColor Cyan
Write-Host "1. Open https://github.com/new and create the repository '$RepoName'."
Write-Host '   Do not initialize it with a README, .gitignore, or license.'
Write-Host '2. Copy the repository URL.'
if ([string]::IsNullOrWhiteSpace($RemoteUrl)) {
  $RemoteUrl = Read-Host 'Paste the repository URL (leave empty to abort)'
}
if ([string]::IsNullOrWhiteSpace($RemoteUrl)) { exit 1 }

$remotes = @(git remote)
if ($remotes -contains 'origin') {
  git remote set-url origin $RemoteUrl
} else {
  git remote add origin $RemoteUrl
}
git push -u origin $branch
if ($LASTEXITCODE -ne 0) {
  Stop-WithMessage 'Push failed. Install GitHub CLI and run gh auth login, or use a Personal Access Token as the HTTPS password.'
}
Write-Host "Published: $RemoteUrl" -ForegroundColor Green
