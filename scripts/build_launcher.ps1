# Build Understudy.exe (double-click launcher) using the .NET Framework C# compiler
# that ships with Windows. Output lands at the repo root.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) { $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe" }
if (-not (Test-Path $csc)) { Write-Error ".NET Framework compiler not found" }

$icon = "$root\scripts\launcher\understudy.ico"
if (-not (Test-Path $icon)) {
    Write-Host "Generating icon..." -ForegroundColor Cyan
    & "$root\.venv\Scripts\python.exe" "$root\scripts\launcher\make_icon.py"
}

Write-Host "Compiling Understudy.exe..." -ForegroundColor Cyan
& $csc /nologo /target:winexe /out:"$root\Understudy.exe" /win32icon:"$icon" `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    "$root\scripts\launcher\Launcher.cs"

Write-Host "Done: $root\Understudy.exe" -ForegroundColor Green
