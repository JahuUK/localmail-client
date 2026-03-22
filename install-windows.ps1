#Requires -RunAsAdministrator
param(
    [string]$InstallDir = "$env:ProgramFiles\LocalMail",
    [int]$Port = 5000,
    [switch]$Uninstall
)

$ServiceName = "LocalMail"
$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "   $msg" -ForegroundColor Red }

if ($Uninstall) {
    Write-Step "Uninstalling $ServiceName..."
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    if ($svc) {
        if ($svc.Status -eq "Running") { Stop-Service $ServiceName -Force }
        sc.exe delete $ServiceName | Out-Null
        Write-Ok "Service removed."
    } else {
        Write-Ok "Service not found, nothing to remove."
    }
    $fw = Get-NetFirewallRule -DisplayName $ServiceName -ErrorAction SilentlyContinue
    if ($fw) { Remove-NetFirewallRule -DisplayName $ServiceName; Write-Ok "Firewall rule removed." }
    Write-Host "`nApp files remain in $InstallDir (contains your email data)."
    Write-Host "To fully remove, delete that folder manually.`n"
    exit 0
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Yellow
Write-Host "        LocalMail Installer for Windows      " -ForegroundColor Yellow
Write-Host "============================================" -ForegroundColor Yellow
Write-Host ""
Write-Host "Install directory : $InstallDir"
Write-Host "Web UI port       : $Port"
Write-Host ""

Write-Step "Checking for Node.js..."
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Err "Node.js is not installed."
    Write-Host "   Please install Node.js 20+ from https://nodejs.org and re-run this script."
    exit 1
}
$nodeVersion = (node --version) -replace "^v", ""
$major = [int]($nodeVersion.Split(".")[0])
if ($major -lt 20) {
    Write-Err "Node.js $nodeVersion found but version 20+ is required."
    Write-Host "   Please update Node.js from https://nodejs.org"
    exit 1
}
Write-Ok "Node.js v$nodeVersion found."

# ---------------------------------------------------------------
# Admin credentials
# ---------------------------------------------------------------
Write-Step "Setting up admin account..."
$configFile = Join-Path $InstallDir "data\.localmail-config"
$existingInstall = Test-Path $configFile

if ($existingInstall) {
    Write-Ok "Existing installation detected. Admin credentials will not be changed."
    $adminUsername  = $null
    $adminPassword  = $null
    $encryptionKey  = (Get-Content $configFile | Where-Object { $_ -match "^ENCRYPTION_KEY=" }) -replace "^ENCRYPTION_KEY=", ""
} else {
    $adminUsername = Read-Host "   Admin username (default: admin)"
    if ([string]::IsNullOrWhiteSpace($adminUsername)) { $adminUsername = "admin" }

    do {
        $adminPass1 = Read-Host "   Admin password" -AsSecureString
        $adminPass2 = Read-Host "   Confirm password" -AsSecureString
        $p1 = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
                  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPass1))
        $p2 = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
                  [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($adminPass2))
        if ($p1 -ne $p2) { Write-Err "Passwords do not match, try again." }
        if ($p1.Length -lt 8) { Write-Err "Password must be at least 8 characters." ; $p1 = "" }
    } while ($p1 -ne $p2 -or $p1.Length -lt 8)
    $adminPassword = $p1

    # Generate a cryptographically random 32-byte (64 hex char) encryption key
    $rng   = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $encryptionKey = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
    Write-Ok "Generated unique encryption key."
}

Write-Step "Checking for nssm (service manager)..."
$nssmCmd = Get-Command nssm -ErrorAction SilentlyContinue
$nssmPath = if ($nssmCmd) { $nssmCmd.Source } else { Join-Path $InstallDir "nssm.exe" }
if (-not $nssmCmd -and -not (Test-Path $nssmPath)) {
    Write-Host "   nssm.exe not found. Downloading..."
    $nssmZip = Join-Path $env:TEMP "nssm.zip"
    $nssmUrl = "https://nssm.cc/release/nssm-2.24.zip"
    try {
        Invoke-WebRequest -Uri $nssmUrl -OutFile $nssmZip -UseBasicParsing
        $nssmExtract = Join-Path $env:TEMP "nssm-extract"
        Expand-Archive -Path $nssmZip -DestinationPath $nssmExtract -Force
        if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
        $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
        Copy-Item (Join-Path $nssmExtract "nssm-2.24\$arch\nssm.exe") $nssmPath
        Remove-Item $nssmZip, $nssmExtract -Recurse -Force -ErrorAction SilentlyContinue
        Write-Ok "nssm.exe downloaded to $nssmPath"
    } catch {
        Write-Err "Failed to download nssm. Please install it manually from https://nssm.cc"
        exit 1
    }
}
if ($nssmCmd) { $nssmPath = $nssmCmd.Source }
Write-Ok "nssm found at $nssmPath"

Write-Step "Copying application files to $InstallDir..."
if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }
$sourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$filesToCopy = @("package.json", "package-lock.json")
$dirsToCopy  = @("server", "shared", "client", "script")
foreach ($f in $filesToCopy) {
    $src = Join-Path $sourceDir $f
    if (Test-Path $src) { Copy-Item $src $InstallDir -Force }
}
foreach ($d in $dirsToCopy) {
    $src = Join-Path $sourceDir $d
    if (Test-Path $src) { Copy-Item $src (Join-Path $InstallDir $d) -Recurse -Force }
}
$extraFiles = @("tsconfig.json", "vite.config.ts", "vite-plugin-meta-images.ts", "components.json", "postcss.config.js", "drizzle.config.ts", "theme.json")
foreach ($f in $extraFiles) {
    $src = Join-Path $sourceDir $f
    if (Test-Path $src) { Copy-Item $src $InstallDir -Force }
}
Write-Ok "Files copied."

Write-Step "Installing dependencies..."
Push-Location $InstallDir
npm ci 2>&1 | Out-Null
Write-Ok "Dependencies installed."

Write-Step "Building application..."
npm run build 2>&1 | Out-Null
Write-Ok "Build complete."
Pop-Location

$dataDir = Join-Path $InstallDir "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

# Save config so upgrades can reuse the same encryption key
if (-not $existingInstall) {
    "ENCRYPTION_KEY=$encryptionKey" | Set-Content $configFile
    Write-Ok "Encryption key saved to $configFile"
    Write-Host ""
    Write-Host "   *** IMPORTANT — back up this key! ***" -ForegroundColor Yellow
    Write-Host "   $configFile" -ForegroundColor Yellow
    Write-Host "   Without it, your stored emails cannot be decrypted." -ForegroundColor Yellow
    Write-Host ""
}

Write-Step "Installing Windows service..."
$existingSvc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingSvc) {
    if ($existingSvc.Status -eq "Running") { Stop-Service $ServiceName -Force }
    & $nssmPath remove $ServiceName confirm 2>&1 | Out-Null
}

$nodePath = (Get-Command node).Source
& $nssmPath install $ServiceName $nodePath "dist/index.cjs"
& $nssmPath set $ServiceName AppDirectory $InstallDir
$envExtras = @("NODE_ENV=production", "PORT=$Port", "ENCRYPTION_KEY=$encryptionKey")
if ($adminUsername) { $envExtras += "ADMIN_USERNAME=$adminUsername" }
if ($adminPassword) { $envExtras += "ADMIN_PASSWORD=$adminPassword" }
& $nssmPath set $ServiceName AppEnvironmentExtra $envExtras
& $nssmPath set $ServiceName DisplayName "LocalMail Email Client"
& $nssmPath set $ServiceName Description "Self-hosted Gmail-like email client"
& $nssmPath set $ServiceName Start SERVICE_AUTO_START
& $nssmPath set $ServiceName AppStdout (Join-Path $InstallDir "logs\service.log")
& $nssmPath set $ServiceName AppStderr (Join-Path $InstallDir "logs\error.log")
$logsDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }
& $nssmPath set $ServiceName AppRotateFiles 1
& $nssmPath set $ServiceName AppRotateBytes 1048576
Write-Ok "Service installed."

Write-Step "Adding firewall rule..."
$fw = Get-NetFirewallRule -DisplayName $ServiceName -ErrorAction SilentlyContinue
if (-not $fw) {
    New-NetFirewallRule -DisplayName $ServiceName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port | Out-Null
    Write-Ok "Firewall rule added for port $Port."
} else {
    Write-Ok "Firewall rule already exists."
}

Write-Step "Starting service..."
Start-Service $ServiceName
Start-Sleep -Seconds 2
$svc = Get-Service $ServiceName
if ($svc.Status -eq "Running") {
    Write-Ok "Service is running!"
} else {
    Write-Err "Service may not have started. Check logs at $InstallDir\logs\"
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "   Installation complete!                    " -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""
Write-Host "   Open your browser to: http://localhost:$Port"
Write-Host "   Email data stored in: $InstallDir\data\"
Write-Host "   Service logs:         $InstallDir\logs\"
Write-Host "   Encryption key saved: $InstallDir\data\.localmail-config"
Write-Host ""
Write-Host "   Manage the service:"
Write-Host "     Start:   Start-Service $ServiceName"
Write-Host "     Stop:    Stop-Service $ServiceName"
Write-Host "     Status:  Get-Service $ServiceName"
Write-Host "     Remove:  .\install-windows.ps1 -Uninstall"
Write-Host ""
