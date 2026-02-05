Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repo = "C:\Users\user\source\repos\MongopPcPartPicker"
$projectFile = Join-Path $repo 'project.js'

if (-not (Test-Path $projectFile)) {
  throw "Cannot find project file: $projectFile"
}

# Ensure relative paths in data.js (data-filtered/json/...) resolve correctly.
Set-Location -Path $repo

$mongosh = Get-Command mongosh -ErrorAction Stop

Write-Host "Running: mongosh --file $projectFile" -ForegroundColor Cyan
& $mongosh.Source "mongodb://localhost:27017" --file $projectFile

Write-Host "Verifying counts in MongoPartPicker..." -ForegroundColor Cyan
& $mongosh.Source "mongodb://localhost:27017" --quiet --eval "db.getSiblingDB('MongoPartPicker').components.countDocuments()"
& $mongosh.Source "mongodb://localhost:27017" --quiet --eval "db.getSiblingDB('MongoPartPicker').builds.countDocuments()"
& $mongosh.Source "mongodb://localhost:27017" --quiet --eval "db.getSiblingDB('MongoPartPicker').users.countDocuments()"
