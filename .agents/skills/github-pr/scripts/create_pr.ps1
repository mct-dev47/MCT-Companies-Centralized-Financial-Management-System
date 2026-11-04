param(
    [string]$BranchName = "",
    [string]$CommitMessage = "feat: update project codebase",
    [string]$PRTitle = "",
    [string]$PRBody = "Automated Pull Request targeting dev branch.",
    [string]$BaseBranch = "dev"
)

$ErrorActionPreference = "Continue"
if (Test-Path Variable:\PSNativeCommandUseErrorActionPreference) {
    $PSNativeCommandUseErrorActionPreference = $false
}

# Auto-detect GH_TOKEN from User environment or Git credential store if not present in session
if (-not $env:GH_TOKEN) {
    $userToken = [System.Environment]::GetEnvironmentVariable("GH_TOKEN", "User")
    if ($userToken) {
        $env:GH_TOKEN = $userToken
    } else {
        $cred = "protocol=https`nhost=github.com" | git credential fill 2>$null | Select-String "password="
        if ($cred) {
            $env:GH_TOKEN = $cred.Line.Replace("password=", "")
        }
    }
}

Write-Host "=== GitHub PR Automation ===" -ForegroundColor Cyan

# 1. Check gh cli authentication
Write-Host "Checking GitHub CLI authentication..." -ForegroundColor Yellow
gh auth status
if ($LASTEXITCODE -ne 0) {
    Write-Error "GitHub CLI is not authenticated. Please run 'gh auth login' first."
    exit 1
}

# 2. Check remote dev branch, create if it doesn't exist
Write-Host "Checking for '$BaseBranch' branch on remote..." -ForegroundColor Yellow
git fetch origin
$remoteDevExists = git branch -r | Select-String "origin/$BaseBranch"
if (-not $remoteDevExists) {
    Write-Host "Remote branch '$BaseBranch' does not exist yet. Creating '$BaseBranch' from current branch..." -ForegroundColor Yellow
    $currentBranch = (git branch --show-current).Trim()
    if ($currentBranch -ne $BaseBranch) {
        git checkout -b $BaseBranch
    }
    git push -u origin $BaseBranch
    Write-Host "Created and pushed '$BaseBranch' branch to remote." -ForegroundColor Green
}

# 3. Create or switch to feature branch if specified
if ($BranchName -ne "") {
    $activeBranch = (git branch --show-current).Trim()
    if ($activeBranch -ne $BranchName) {
        Write-Host "Creating/switching to branch '$BranchName'..." -ForegroundColor Yellow
        git checkout -b $BranchName 2>$null
        if ($LASTEXITCODE -ne 0) {
            git checkout $BranchName
        }
    }
}

$workingBranch = (git branch --show-current).Trim()
Write-Host "Current working branch: $workingBranch" -ForegroundColor Cyan

if ($workingBranch -eq $BaseBranch) {
    Write-Host "Warning: You are currently on '$BaseBranch'. PR cannot target itself." -ForegroundColor Red
    $workingBranch = "feat/update-" + (Get-Date -Format "yyyyMMdd-HHmmss")
    Write-Host "Switching to new feature branch '$workingBranch'..." -ForegroundColor Yellow
    git checkout -b $workingBranch
}

# 4. Stage and commit changes if any
$status = git status --porcelain
if ($status) {
    Write-Host "Staging changes..." -ForegroundColor Yellow
    git add .
    Write-Host "Committing changes..." -ForegroundColor Yellow
    git commit -m $CommitMessage
} else {
    Write-Host "No unstaged changes to commit." -ForegroundColor Green
}

# 5. Push branch to remote
Write-Host "Pushing branch '$workingBranch' to origin..." -ForegroundColor Yellow
git push -u origin $workingBranch

# 6. Create Pull Request
if ($PRTitle -eq "") {
    $PRTitle = $CommitMessage
}

Write-Host "Creating Pull Request targeting '$BaseBranch'..." -ForegroundColor Yellow
gh pr create --base $BaseBranch --head $workingBranch --title "$PRTitle" --body "$PRBody"

Write-Host "=== Pull Request Successfully Created! ===" -ForegroundColor Green
