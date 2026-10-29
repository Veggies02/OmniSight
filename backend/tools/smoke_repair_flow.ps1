# Smoke test of the OmniSight repair flow against a RUNNING backend.
# Run it from the repo root (the smoke clone), in its own terminal:
#   powershell -ExecutionPolicy Bypass -File .\smoke_repair_flow.ps1
#
# Needs: the app on http://127.0.0.1:5173 and the backend on http://127.0.0.1:8000 started with
#   OMNISIGHT_RUNNER=playwright and OMNISIGHT_OPERATOR_TOKEN set, and a repair_proposals.json
#   generated in THIS clone (a proposal records the hash of src/index.css).
# What it does: create job -> wait for capture -> attach one proposal -> approve -> repair -> poll.
param(
    [string]$Base = "http://127.0.0.1:8000",
    [string]$Token = $env:OMNISIGHT_OPERATOR_TOKEN,
    [string]$Scenario = "product-image-distortion",
    [string]$ProposalsFile = "",
    [string]$Reviewer = "smoke-test"
)

$ErrorActionPreference = "Stop"
if (-not $Token) { throw "Set OMNISIGHT_OPERATOR_TOKEN in this terminal first, or pass -Token." }

if (-not $ProposalsFile) {
    $latest = Get-ChildItem "artifacts\repair-proposals" -Directory | Sort-Object Name | Select-Object -Last 1
    if (-not $latest) { throw "No artifacts\repair-proposals folder. Run repair:proposals in this clone first." }
    $ProposalsFile = Join-Path $latest.FullName "repair_proposals.json"
}
Write-Host "Proposals file: $ProposalsFile"
$all = Get-Content $ProposalsFile -Raw | ConvertFrom-Json
$proposal = $all.$Scenario
if (-not $proposal) { throw "Scenario '$Scenario' was not found in $ProposalsFile" }
Write-Host ("Using proposal {0} (provider: {1})" -f $proposal.proposalId, $proposal.diagnosisRef.provider)

$headers = @{ "X-Operator-Token" = $Token }

function Call-Api([string]$Method, [string]$Path, $Body = $null, [bool]$Protected = $false) {
    $args2 = @{ Method = $Method; Uri = "$Base$Path"; ContentType = "application/json" }
    if ($Protected) { $args2["Headers"] = $headers }
    if ($Body -ne $null) {
        $json = $Body | ConvertTo-Json -Depth 30
        $args2["Body"] = [System.Text.Encoding]::UTF8.GetBytes($json)
    }
    try {
        return Invoke-RestMethod @args2
    } catch {
        $detail = $_.ErrorDetails.Message
        if (-not $detail) { $detail = $_.Exception.Message }
        throw "API call failed: $Method $Path -> $detail"
    }
}

function Wait-Job([string]$JobId, [string[]]$Until, [int]$TimeoutSeconds) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $job = Call-Api "GET" "/jobs/$JobId"
        Write-Host ("  status={0} stage={1}" -f $job.status, $job.stage)
        if ($Until -contains $job.status) { return $job }
        Start-Sleep -Seconds 5
    }
    throw "Timed out after $TimeoutSeconds seconds waiting for $($Until -join ' or ')."
}

Write-Host "`n1. Creating a job (real capture)..."
$created = Call-Api "POST" "/jobs" @{ website_url = "http://127.0.0.1:5173" }
$jobId = $created.job_id
Write-Host "   job_id: $jobId"
$job = Wait-Job $jobId @("analyzing", "failed") 300
if ($job.status -eq "failed") { throw "Capture failed: $($job.error)" }
Write-Host ("   captured: run_id={0} exit_code={1} artifacts={2}" -f $job.inspection.run_id, $job.inspection.exit_code, $job.artifacts.Count)

Write-Host "`n2. Attaching the proposal..."
$job = Call-Api "POST" "/jobs/$jobId/proposal" @{ proposal = $proposal } $true
Write-Host ("   status={0} stage={1} proposal.humanReviewStatus={2}" -f $job.status, $job.stage, $job.proposal.humanReviewStatus)

Write-Host "`n3. Trying to repair BEFORE approval (this must be refused)..."
try {
    Call-Api "POST" "/jobs/$jobId/repair" $null $true | Out-Null
    throw "UNEXPECTED: repair was accepted without approval."
} catch {
    if ($_.Exception.Message -like "UNEXPECTED*") { throw }
    Write-Host "   refused as expected: $($_.Exception.Message)"
}

Write-Host "`n4. Approving as '$Reviewer'..."
$job = Call-Api "POST" "/jobs/$jobId/approval" @{ reviewed_by = $Reviewer } $true
Write-Host ("   approval: {0} at {1}" -f $job.approval.reviewed_by, $job.approval.reviewed_at)

Write-Host "`nIMPORTANT: the repair's required tests run inside the worktree. If the dev server on port 5173"
Write-Host "is still running, they may test THAT app instead of the patched worktree."
Write-Host "Stop the dev server terminal now (Ctrl+C there), then come back."
Read-Host "Press Enter here when the dev server is stopped"

Write-Host "`n5. Starting the repair (this takes a few minutes)..."
$job = Call-Api "POST" "/jobs/$jobId/repair" $null $true
Write-Host ("   status={0} stage={1}" -f $job.status, $job.stage)
$job = Wait-Job $jobId @("completed", "failed") 1200

Write-Host "`n=== RESULT ==="
Write-Host ("status: {0}   stage: {1}" -f $job.status, $job.stage)
if ($job.error) { Write-Host "error: $($job.error)" }
if ($job.repair) {
    $r = $job.repair
    Write-Host ("outcome={0} exit_code={1} final_state={2}" -f $r.outcome, $r.exit_code, $r.final_state)
    Write-Host ("build_passed={0} test_passed={1} visual_passed={2}" -f $r.build_passed, $r.test_passed, $r.visual_passed)
    Write-Host ("failure_reason: {0}" -f $r.failure_reason)
    Write-Host ("report: {0}" -f $r.report_path)
    Write-Host ("cleanup: {0}" -f ($r.cleanup | ConvertTo-Json -Compress))
}
Write-Host "`nFull job JSON:"
$job | ConvertTo-Json -Depth 30