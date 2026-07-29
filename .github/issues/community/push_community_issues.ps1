<#
.SYNOPSIS
    Push all US-*.md community issue files to Emporio-Labs/FITFLIX_BACKEND.
.DESCRIPTION
    Parses each community issue markdown file in this directory, extracts the
    title from line 1 and the Type from line 3, routes to the correct GitHub
    repo via $RepoMap, and creates the issue using `gh issue create`.

    Prerequisites:
      - `gh auth status` returns authenticated.
      - The invoking user has issue-create permission on the target repo.
.PARAMETER DryRun
    If specified, prints the commands without executing them.
.PARAMETER Repo
    Overrides the Type-based repo routing for this run. Optional.
.PARAMETER Filter
    File glob to select issue files. Defaults to `US-*.md`.
.EXAMPLE
    .\push_community_issues.ps1 -DryRun
    .\push_community_issues.ps1 -Filter "US-O1-*.md"
    .\push_community_issues.ps1
#>
param(
    [switch]$DryRun,
    [string]$Repo,
    [string]$Filter = "US-*.md",
    [string[]]$Exclude
)

# ── Configuration ──────────────────────────────────────────────────────────────
$IssuesDir = $PSScriptRoot  # Same directory as this script

# Repo routing map based on the **Type:** field.
$RepoMap = @{
    "Backend Community Feature" = "Emporio-Labs/FITFLIX_BACKEND"
}

# ── Results tracking ──────────────────────────────────────────────────────────
$results = @()
$successCount = 0
$failCount = 0
$skipCount = 0

# ── Get all issue files sorted ────────────────────────────────────────────────
$issueFiles = @(Get-ChildItem -Path $IssuesDir -Filter $Filter | Sort-Object Name)
if ($Exclude) {
    $issueFiles = @($issueFiles | Where-Object {
        $name = $_.Name
        -not ($Exclude | Where-Object { $name -like $_ })
    })
}
$totalFiles = $issueFiles.Count
$fileIndex = 0

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
if ($DryRun) {
    Write-Host "  DRY RUN - GitHub Issue Push (No issues will be created)" -ForegroundColor Yellow
} else {
    Write-Host "  LIVE RUN - Creating GitHub Issues" -ForegroundColor Green
}
Write-Host "  Found $($issueFiles.Count) issue files" -ForegroundColor Cyan
if ($Repo) {
    Write-Host "  Repo override: $Repo" -ForegroundColor Cyan
}
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

foreach ($file in $issueFiles) {
    $fileIndex++
    $filePath = $file.FullName
    $fileName = $file.Name

    # ── Read file content ──────────────────────────────────────────────────
    $lines = Get-Content -Path $filePath -Encoding UTF8

    # ── Extract title from line 1 ──────────────────────────────────────────
    # Format: # 🚀 US-O1 - Browse Community Posts (Outsider)
    # Strip the leading "# " and any leading non-alphanumeric chars (emoji, whitespace).
    $titleLine = $lines[0]
    $title = ($titleLine -replace "^#\s+", "") -replace "^[^\p{L}\p{N}]+", ""

    # ── Extract type from line 3 ──────────────────────────────────────────
    # Format: **Type:** Backend Community Feature
    $typeLine = $lines[2]
    $typeValue = ($typeLine -replace "^\*\*Type:\*\*\s*", "").Trim()

    # ── Resolve repo ──────────────────────────────────────────────────────
    if ($Repo) {
        $targetRepo = $Repo
    } else {
        $targetRepo = $RepoMap[$typeValue]
    }

    if (-not $targetRepo) {
        Write-Host "  [SKIP]  $fileName -- Unknown type: '$typeValue'" -ForegroundColor Yellow
        $skipCount++
        $results += [PSCustomObject]@{
            File   = $fileName
            Title  = $title
            Type   = $typeValue
            Repo   = "UNKNOWN"
            Status = "SKIPPED"
            Detail = "Unknown type"
        }
        continue
    }

    # ── Display info ──────────────────────────────────────────────────────
    $repoShort = $targetRepo.Split("/")[1]
    Write-Host "  [$fileIndex/$totalFiles] $fileName" -ForegroundColor White
    Write-Host "         Title: $title" -ForegroundColor Gray
    Write-Host "         Repo:  $repoShort" -ForegroundColor Gray

    if ($DryRun) {
        # ── Dry run: just print the command ────────────────────────────────
        Write-Host "         CMD:   gh issue create --repo `"$targetRepo`" --title `"$title`" --body-file `"$filePath`"" -ForegroundColor DarkGray
        Write-Host "         [OK]   DRY RUN" -ForegroundColor DarkYellow
        $successCount++
        $results += [PSCustomObject]@{
            File   = $fileName
            Title  = $title
            Type   = $typeValue
            Repo   = $targetRepo
            Status = "DRY_RUN"
            Detail = "Command printed"
        }
    } else {
        # ── Live run: execute gh issue create ──────────────────────────────
        try {
            $output = gh issue create --repo "$targetRepo" --title "$title" --body-file "$filePath" 2>&1
            $exitCode = $LASTEXITCODE
            if ($exitCode -eq 0) {
                Write-Host "         [OK]   CREATED: $output" -ForegroundColor Green
                $successCount++
                $results += [PSCustomObject]@{
                    File   = $fileName
                    Title  = $title
                    Type   = $typeValue
                    Repo   = $targetRepo
                    Status = "CREATED"
                    Detail = "$output"
                }
            } else {
                Write-Host "         [FAIL] $output" -ForegroundColor Red
                $failCount++
                $results += [PSCustomObject]@{
                    File   = $fileName
                    Title  = $title
                    Type   = $typeValue
                    Repo   = $targetRepo
                    Status = "FAILED"
                    Detail = "$output"
                }
            }
        } catch {
            Write-Host "         [ERROR] $_" -ForegroundColor Red
            $failCount++
            $results += [PSCustomObject]@{
                File   = $fileName
                Title  = $title
                Type   = $typeValue
                Repo   = $targetRepo
                Status = "ERROR"
                Detail = "$_"
            }
        }
    }
    Write-Host ""
}

# ── Summary ───────────────────────────────────────────────────────────────────
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  SUMMARY" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Total files:  $($issueFiles.Count)" -ForegroundColor White
Write-Host "  Success:      $successCount" -ForegroundColor Green
Write-Host "  Failed:       $failCount" -ForegroundColor Red
Write-Host "  Skipped:      $skipCount" -ForegroundColor Yellow
Write-Host ""

# ── Breakdown by repo ─────────────────────────────────────────────────────────
Write-Host "  By Repository:" -ForegroundColor Cyan
$results | Where-Object { $_.Status -ne "SKIPPED" } | Group-Object Repo | ForEach-Object {
    Write-Host "    $($_.Name): $($_.Count) issues" -ForegroundColor White
}
Write-Host ""

# ── Export results log ────────────────────────────────────────────────────────
$logFile = Join-Path $IssuesDir "push_results.csv"
$results | Export-Csv -Path $logFile -NoTypeInformation -Encoding UTF8
Write-Host "  Results log saved to: $logFile" -ForegroundColor Gray
Write-Host ""
