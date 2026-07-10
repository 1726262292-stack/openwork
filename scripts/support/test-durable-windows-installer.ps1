param(
  [Parameter(Mandatory = $true)]
  [string] $PackagePath,

  [Parameter(Mandatory = $true)]
  [string] $OldConfigUrl,

  [Parameter(Mandatory = $true)]
  [string] $NewConfigUrl,

  [Parameter(Mandatory = $true)]
  [string] $OutputPath,

  [string] $ExpectedPublisher = "",

  [string] $PreparedDirectory = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.Net.Http

function Get-HttpStatus([string] $Url) {
  $client = [System.Net.Http.HttpClient]::new()
  try {
    $response = $client.GetAsync($Url).GetAwaiter().GetResult()
    try {
      return [int] $response.StatusCode
    }
    finally {
      $response.Dispose()
    }
  }
  finally {
    $client.Dispose()
  }
}

$resolvedPackagePath = (Resolve-Path -LiteralPath $PackagePath).Path
$removeWorkDir = -not $PreparedDirectory
$workDir = if ($PreparedDirectory) {
  [System.IO.Path]::GetFullPath($PreparedDirectory)
}
else {
  Join-Path ([System.IO.Path]::GetTempPath()) ("openwork-installer-proof-" + [guid]::NewGuid().ToString("N"))
}
$extractDir = if ($PreparedDirectory) { $workDir } else { Join-Path $workDir "package" }
if ($PreparedDirectory -and (Test-Path -LiteralPath $extractDir)) {
  throw "PreparedDirectory must not already exist: $extractDir"
}
New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

try {
  Expand-Archive -LiteralPath $resolvedPackagePath -DestinationPath $extractDir
  $executables = @(Get-ChildItem -LiteralPath $extractDir -Filter "*.exe" -File)
  if ($executables.Count -ne 1) {
    throw "Expected exactly one executable at the package root; found $($executables.Count)."
  }

  $sidecarPath = Join-Path $extractDir "openwork-installer.json"
  if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
    throw "The package does not contain openwork-installer.json at its root."
  }

  $originalPath = $executables[0].FullName
  $signature = Get-AuthenticodeSignature -FilePath $originalPath
  if ($signature.Status -ne "Valid") {
    throw "Expected a valid Authenticode signature, got $($signature.Status): $($signature.StatusMessage)"
  }
  $publisher = $signature.SignerCertificate.Subject
  if ($ExpectedPublisher -and $publisher -notlike "*$ExpectedPublisher*") {
    throw "Expected publisher containing '$ExpectedPublisher', got '$publisher'."
  }

  $originalHash = (Get-FileHash -LiteralPath $originalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $renamedPath = Join-Path $extractDir "Renamed Organization Setup.exe"
  Move-Item -LiteralPath $originalPath -Destination $renamedPath
  $renamedHash = (Get-FileHash -LiteralPath $renamedPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($originalHash -ne $renamedHash) {
    throw "Renaming the installer changed its bytes."
  }

  $config = Get-Content -LiteralPath $sidecarPath -Raw | ConvertFrom-Json
  $configOutput = (& $renamedPath --check-config 2>&1 | Out-String).Trim()
  $installerExitCode = $LASTEXITCODE
  if ($installerExitCode -ne 0) {
    throw "Renamed installer config check exited $installerExitCode`: $configOutput"
  }
  if ($configOutput -notmatch "Configured via install link") {
    throw "Renamed installer did not resolve its adjacent sidecar: $configOutput"
  }

  $oldStatus = Get-HttpStatus $OldConfigUrl
  $newStatus = Get-HttpStatus $NewConfigUrl
  if ($oldStatus -ne 404) {
    throw "Expected the rotated link to return 404, got $oldStatus."
  }
  if ($newStatus -ne 200) {
    throw "Expected the new link to return 200, got $newStatus."
  }

  $proof = [ordered]@{
    signatureStatus = [string] $signature.Status
    publisher = $publisher
    originalExecutableSha256 = $originalHash
    renamedExecutableSha256 = $renamedHash
    configSource = "sidecar"
    oldLinkStatusAfterRotation = $oldStatus
    newLinkStatus = $newStatus
    renamedInstallerExitCode = $installerExitCode
    renamedExecutablePath = $renamedPath
    bootstrapBaseUrl = [string] $config.webUrl
    installerOutput = $configOutput
  }

  $outputDirectory = Split-Path -Parent $OutputPath
  if ($outputDirectory) {
    New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  }
  $proofJson = $proof | ConvertTo-Json -Depth 4
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($OutputPath, $proofJson, $utf8WithoutBom)
  Write-Host "Durable Windows installer proof written to $OutputPath"
}
finally {
  if ($removeWorkDir) {
    Remove-Item -LiteralPath $workDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
