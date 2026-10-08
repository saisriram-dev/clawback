<#
  ClawBack team commit helper.
  Copies one step's files from the final ClawBack folder into your clone of the GitHub
  repository, then commits them under YOUR git name. Run the steps in order 1 to 10.

  Usage (in PowerShell, inside your cloned repository folder):
    powershell -ExecutionPolicy Bypass -File C:\hack\ClawBack-final\scripts\team-commit.ps1 -Step 3 -Source C:\hack\ClawBack-final
  Then:  git push

  Optional (everyone committing from one laptop): add -Author "Full Name <github-email>"
#>
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 10)][int]$Step,
  [Parameter(Mandatory = $true)][string]$Source,
  [string]$Author = ''
)
$ErrorActionPreference = 'Stop'

$plan = @{
  1  = @{ who = 'Sai Sri Ram Pitta'; msg = 'chore: project setup, launcher and Gemma setup scripts';
          paths = @('package.json', 'package-lock.json', 'tsconfig.json', 'next.config.mjs', 'vitest.config.mts', '.gitignore', '.env.example', 'LICENSE',
                    'start.bat', 'start.sh', 'start-lan.bat', 'setup-gemma.bat', 'setup-gemma.sh',
                    'scripts/launch.mjs', 'scripts/doctor.mjs', 'scripts/setup-gemma.mjs', 'public') }
  2  = @{ who = 'Sai Sri Ram Pitta'; msg = 'feat(engine): dated IEEPA rate table, CBP interest, absorption ledger, leverage and settlement ladder';
          paths = @('src/lib/types.ts', 'src/lib/engine', 'src/lib/ledger.ts', 'tests/engine.test.ts') }
  3  = @{ who = 'Tanish Kinthali'; msg = 'feat(extraction): document ingest, rules extractor, Gemma client (Ollama and Google AI Studio) and grounding check';
          paths = @('src/lib/extraction', 'tests/gemma.test.ts', 'tests/google.test.ts') }
  4  = @{ who = 'Tanish Kinthali'; msg = 'feat(server): workspace store, processing queue, buyer matching and demo dataset';
          paths = @('src/lib/server/store.ts', 'src/lib/server/pipeline.ts', 'src/lib/server/buyers.ts', 'src/lib/server/demo.ts',
                    'demo', 'scripts/make-demo-docs.mjs', 'tests/pipeline.test.ts', 'tests/server.test.ts') }
  5  = @{ who = 'Harshith Reddy'; msg = 'feat(auth): sign up and sign in, signed session cookies, page guard, per-company data isolation, health check';
          paths = @('src/lib/auth', 'src/lib/server/auth.ts', 'src/lib/server/tenant.ts', 'src/lib/server/api.ts', 'src/middleware.ts',
                    'src/app/api/auth', 'src/app/api/health', 'tests/auth.test.ts') }
  6  = @{ who = 'Harshith Reddy'; msg = 'feat(api): documents, buyers, ledger lines, settings, export, engine and buyer portal endpoints';
          paths = @('src/app/api/buyers', 'src/app/api/demo', 'src/app/api/documents', 'src/app/api/engine', 'src/app/api/export',
                    'src/app/api/lines', 'src/app/api/portal', 'src/app/api/settings', 'src/app/api/workspace') }
  7  = @{ who = 'Adithya Bukkineni'; msg = 'feat(ui): vibrant design system, app shell, proof drawer, refund estimator and live interest ticker';
          paths = @('src/app/globals.css', 'src/app/layout.tsx', 'src/components', 'src/lib/client.ts') }
  8  = @{ who = 'Adithya Bukkineni'; msg = 'feat(pages): landing, sign in, portfolio, intake, buyers, negotiation, pipeline, settings, claim pack and buyer portal';
          paths = @('src/app/(app)', 'src/app/welcome', 'src/app/login', 'src/app/signup', 'src/app/claim', 'src/app/r') }
  9  = @{ who = 'Harshith Reddy'; msg = 'chore(deploy): Render blueprint with persistent disk and Gemma, deployment guide';
          paths = @('render.yaml', 'docs/DEPLOY.md') }
  10 = @{ who = 'Sai Sri Ram Pitta'; msg = 'docs: README in the hackathon template, pitch, user guide and team workflow';
          paths = @('README.md', 'docs/PITCH.md', 'docs/USER-GUIDE.md', 'docs/TEAM-COMMITS.md', 'scripts/team-commit.ps1') }
}

$Source = (Resolve-Path -LiteralPath $Source).Path
$Repo = (Get-Location).Path
if (-not (Test-Path -LiteralPath (Join-Path $Repo '.git'))) { throw "Run this inside your cloned repository folder (the one with a .git folder). You are in: $Repo" }
if ($Source -eq $Repo) { throw 'Source and repository are the same folder. -Source must be the unzipped final ClawBack folder.' }

$s = $plan[$Step]
Write-Host ""
Write-Host "  Step $Step of 10 - owner: $($s.who)" -ForegroundColor Cyan
Write-Host "  $($s.msg)"
Write-Host ""

$null = git rev-parse -q --verify HEAD
$hasCommits = ($LASTEXITCODE -eq 0)
if ($hasCommits) {
  git pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'git pull failed. Fix that first (is the previous step pushed?).' }
} elseif ($Step -ne 1) {
  throw 'This repository has no commits yet. Step 1 must be committed and pushed first.'
}

foreach ($p in $s.paths) {
  $win = $p -replace '/', '\'
  $src = Join-Path $Source $win
  $dst = Join-Path $Repo $win
  if (-not (Test-Path -LiteralPath $src)) { throw "Missing in the final folder: $p" }
  if ((Get-Item -LiteralPath $src).PSIsContainer) {
    robocopy $src $dst /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Copy failed: $p" }
  } else {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dst) | Out-Null
    Copy-Item -LiteralPath $src -Destination $dst -Force
  }
  Write-Host "  + $p"
}

git --literal-pathspecs add -- $s.paths
if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
if ($Author) { git commit -m $s.msg --author $Author } else { git commit -m $s.msg }
if ($LASTEXITCODE -ne 0) { throw 'git commit failed (nothing to commit, or git name/email not set).' }

if (-not $hasCommits) { git branch -M main }
Write-Host ""
if (-not $hasCommits) { Write-Host "  Committed. Now run:  git push -u origin main" -ForegroundColor Green }
else { Write-Host "  Committed. Now run:  git push" -ForegroundColor Green }
if ($Step -lt 10) { Write-Host "  Then tell the owner of step $($Step + 1) ($($plan[$Step + 1].who)) to go." }
else { Write-Host "  That was the last step. The repository is complete." }
