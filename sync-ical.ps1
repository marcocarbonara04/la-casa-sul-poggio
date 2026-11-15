param(
  [switch]$NoPush
)

$ErrorActionPreference = 'Stop'
$feedUrl = 'https://www.airbnb.it/calendar/ical/1134012891756639465.ics?t=0696334737ca4cc78180a9b42bccc5c7'
$icsPath = Join-Path $PSScriptRoot 'assets\data\airbnb.ics'
$jsonPath = Join-Path $PSScriptRoot 'assets\data\availability.json'

$resp = Invoke-WebRequest -Uri $feedUrl -Headers @{ 'User-Agent' = 'Mozilla/5.0' } -UseBasicParsing -TimeoutSec 20
$rawIcs = [string]$resp.Content
if (-not $rawIcs.Contains('BEGIN:VCALENDAR')) {
  throw 'Risposta iCal Airbnb non valida.'
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
New-Item -ItemType Directory -Force -Path (Split-Path $icsPath) | Out-Null
[System.IO.File]::WriteAllText($icsPath, ($rawIcs -replace "\r\n", "`n").TrimEnd() + "`n", $utf8NoBom)

$unfolded = ($rawIcs -replace "\r\n?", "`n") -replace "\n[ \t]", ''
$events = [regex]::Matches($unfolded, 'BEGIN:VEVENT[\s\S]*?END:VEVENT')
$ranges = @()
foreach ($ev in $events) {
  $mStart = [regex]::Match($ev.Value, 'DTSTART(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})')
  if (-not $mStart.Success) { continue }
  $startIso = "$($mStart.Groups[1].Value)-$($mStart.Groups[2].Value)-$($mStart.Groups[3].Value)"
  $mEnd = [regex]::Match($ev.Value, 'DTEND(?:;[^:]*)?:(\d{4})(\d{2})(\d{2})')
  $endIso = if ($mEnd.Success) { "$($mEnd.Groups[1].Value)-$($mEnd.Groups[2].Value)-$($mEnd.Groups[3].Value)" } else { $startIso }
  $ranges += [ordered]@{ start = $startIso; end = $endIso }
}

$rangesJson = ($ranges | ForEach-Object { "    { `"start`": `"$($_.start)`", `"end`": `"$($_.end)`" }" }) -join ",`n"
$updatedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$jsonBody = @"
{
  "updatedAt": "$updatedAt",
  "source": "airbnb",
  "blockedRanges": [
$rangesJson
  ]
}
"@
[System.IO.File]::WriteAllText($jsonPath, ($jsonBody -replace "\r\n", "`n") + "`n", $utf8NoBom)

Write-Host "Sincronizzati $($ranges.Count) periodi occupati da Airbnb."

if (-not $NoPush) {
  Push-Location $PSScriptRoot
  try {
    $status = git status --porcelain -- assets/data/airbnb.ics assets/data/availability.json
    if ($status) {
      git add -- assets/data/airbnb.ics assets/data/availability.json
      git commit -m "chore(ical): sync Airbnb availability"
      git push origin main
      Write-Host 'Modifiche pubblicate su GitHub Pages.'
    } else {
      Write-Host 'Nessuna variazione nel calendario rispetto all ultimo sync.'
    }
  } finally {
    Pop-Location
  }
}
