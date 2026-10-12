$ErrorActionPreference = "Stop"
$port = 8765
Write-Host "MASITECH Payroll preview: http://localhost:$port/"
Write-Host "Press Ctrl+C to stop."
python -m http.server $port
