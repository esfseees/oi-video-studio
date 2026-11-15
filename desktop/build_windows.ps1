$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)
$Root = (Get-Location).Path
$Pkg = Get-Content "$Root\package.json" -Raw | ConvertFrom-Json
$Ver = $Pkg.version

$StageDir = "$Root\dist\OIVideoStudio"
$RuntimeDir = "$StageDir\runtime"
$AppDir = "$StageDir\app"
$ZipOut = "$Root\dist\信奥讲解视频工坊-v$Ver-windows-x64.zip"

Write-Host "[1/6] Cleaning staging directory..."
if (Test-Path $StageDir) { Remove-Item -Recurse -Force $StageDir }
if (Test-Path $ZipOut) { Remove-Item -Force $ZipOut }
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

Write-Host "[2/6] Preparing portable Node.js runtime..."
$NodeExe = (Get-Command node).Source
Copy-Item $NodeExe "$RuntimeDir\node.exe" -Force

Write-Host "[3/6] Preparing portable FFmpeg runtime..."
$FfmpegCmd = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($FfmpegCmd) {
    Copy-Item $FfmpegCmd.Source "$RuntimeDir\ffmpeg.exe" -Force
} else {
    $FfZip = "$env:TEMP\ffmpeg-win64.zip"
    $FfExtract = "$env:TEMP\ffmpeg-extract"
    Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $FfZip
    if (Test-Path $FfExtract) { Remove-Item -Recurse -Force $FfExtract }
    Expand-Archive -Path $FfZip -DestinationPath $FfExtract -Force
    $FoundFf = Get-ChildItem -Path $FfExtract -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
    if (-not $FoundFf) { throw "Failed to locate ffmpeg.exe in downloaded archive" }
    Copy-Item $FoundFf.FullName "$RuntimeDir\ffmpeg.exe" -Force
}

Write-Host "[4/6] Copying application files..."
$Exclude = @(".git", ".github", ".venv", "data", "dist", ".env", ".DS_Store")
Get-ChildItem -Path $Root -Force | Where-Object { $Exclude -notcontains $_.Name } | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination "$AppDir\$($_.Name)" -Recurse -Force
}

Write-Host "[5/6] Compiling Windows native GUI launcher (信奥讲解视频工坊.exe)..."
$Csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $Csc)) {
    $Csc = (Get-ChildItem "C:\Windows\Microsoft.NET\Framework*" -Filter "csc.exe" -Recurse | Select-Object -Last 1).FullName
}
$ExePath = "$StageDir\信奥讲解视频工坊.exe"
& $Csc /nologo /target:winexe /out:$ExePath "/win32icon:$Root\desktop\icon.ico" /r:System.Windows.Forms.dll /r:System.Drawing.dll "$Root\desktop\Launcher.cs"
if ($LASTEXITCODE -ne 0) { throw "csc.exe compilation failed" }

# Also create a convenience batch script for LAN mode
Set-Content -Path "$StageDir\启动局域网共享模式.bat" -Value "@echo off`r`ncd /d ""%~dp0app""`r`nset ""OIVS_DATA_DIR=%APPDATA%\OIVideoStudio""`r`nset ""OIVS_FFMPEG=%~dp0runtime\ffmpeg.exe""`r`n""%~dp0runtime\node.exe"" scripts\start.js --lan`r`npause" -Encoding UTF8

Write-Host "[5.5/6] Running self-test on built Windows package..."
& "$RuntimeDir\node.exe" "$AppDir\scripts\start.js" --self-test
if ($LASTEXITCODE -ne 0) { throw "Windows self-test failed" }

Write-Host "[6/6] Building portable ZIP and Inno Setup installer..."
Compress-Archive -Path "$StageDir\*" -DestinationPath $ZipOut -Force

$Iscc = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $Iscc)) {
    $IsccCmd = Get-Command iscc -ErrorAction SilentlyContinue
    if ($IsccCmd) { $Iscc = $IsccCmd.Source }
}
if (Test-Path $Iscc) {
    & $Iscc "/DMyAppVersion=$Ver" "$Root\desktop\installer.iss"
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup compilation failed" }
} else {
    Write-Warning "ISCC.exe not found, skipping setup.exe creation"
}

Write-Host "Windows build completed successfully!"
Get-ChildItem "$Root\dist"
