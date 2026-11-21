$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$sdkRoot = Join-Path $projectRoot 'vendor/discord_social_sdk'
if (!(Test-Path -LiteralPath (Join-Path $sdkRoot 'include/discordpp.h'))) {
  if (!$env:DISCORD_SOCIAL_SDK_URL -or !([Uri]$env:DISCORD_SOCIAL_SDK_URL).Scheme.Equals('https')) {
    throw 'Place the Discord C++ Social SDK in vendor/discord_social_sdk, or provide DISCORD_SOCIAL_SDK_URL for a private HTTPS archive.'
  }
  $vendorRoot = Join-Path $projectRoot 'vendor'
  New-Item -ItemType Directory -Path $vendorRoot -Force | Out-Null
  $sdkArchive = Join-Path $vendorRoot 'discord-sdk.zip'
  try { Invoke-WebRequest -Uri $env:DISCORD_SOCIAL_SDK_URL -OutFile $sdkArchive } catch { throw 'Discord SDK download failed' }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($sdkArchive)
  try {
    foreach ($entry in $archive.Entries) {
      $targetPath = [IO.Path]::GetFullPath([IO.Path]::Combine($vendorRoot, $entry.FullName))
      if (!$targetPath.StartsWith($vendorRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe SDK archive path' }
    }
  } finally { $archive.Dispose() }
  Expand-Archive -LiteralPath $sdkArchive -DestinationPath $vendorRoot -Force
  Remove-Item -LiteralPath $sdkArchive
}
$sdkManifest = Get-Content -LiteralPath (Join-Path $projectRoot 'native/discord-party/sdk-manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $sdkManifest.files.PSObject.Properties) {
  if ((Get-FileHash -LiteralPath (Join-Path $sdkRoot $entry.Name) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.Value) { throw ('Discord SDK checksum mismatch: ' + $entry.Name) }
}
$jsonRoot = Join-Path $projectRoot 'vendor/nlohmann'
New-Item -ItemType Directory -Path $jsonRoot -Force | Out-Null
$jsonHeader = Join-Path $jsonRoot 'json.hpp'
if (!(Test-Path -LiteralPath $jsonHeader)) {
  Invoke-WebRequest 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/single_include/nlohmann/json.hpp' -OutFile $jsonHeader
}
if ((Get-FileHash -LiteralPath $jsonHeader -Algorithm SHA256).Hash -ne 'AAF127C04CB31C406E5B04A63F1AE89369FCCDE6D8FA7CDDA1ED4F32DFC5DE63') { throw 'Unexpected JSON header checksum' }
$jsonLicense = Join-Path $jsonRoot 'LICENSE.MIT'
if (!(Test-Path -LiteralPath $jsonLicense)) { Invoke-WebRequest 'https://raw.githubusercontent.com/nlohmann/json/v3.12.0/LICENSE.MIT' -OutFile $jsonLicense }
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vsRoot) { throw 'Visual Studio C++ x64 build tools are required' }
$env:Path = (Split-Path -Parent $vswhere) + ';' + $env:Path
Import-Module (Join-Path $vsRoot 'Common7/Tools/Microsoft.VisualStudio.DevShell.dll')
Enter-VsDevShell -VsInstallPath $vsRoot -SkipAutomaticLocation -DevCmdArguments '-arch=x64 -host_arch=x64'
$buildRoot = Join-Path $projectRoot 'native/discord-party/build'
$outputRoot = Join-Path $buildRoot 'out'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$compilerArgs = @('/nologo', '/std:c++20', '/EHsc', '/O2', '/MT', '/utf-8', '/W3',
  ('/I' + (Join-Path $sdkRoot 'include')), ('/I' + (Join-Path $projectRoot 'vendor')),
  (Join-Path $projectRoot 'native/discord-party/main.cpp'),
  ('/Fo' + (Join-Path $buildRoot 'main.obj')), ('/Fe' + (Join-Path $outputRoot 'moewatch-discord.exe')),
  '/link', (Join-Path $sdkRoot 'lib/release/discord_partner_sdk.lib'), 'crypt32.lib', 'bcrypt.lib', 'user32.lib')
& cl.exe @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Discord bridge compilation failed' }
Copy-Item -LiteralPath (Join-Path $sdkRoot 'bin/release/discord_partner_sdk.dll') -Destination $outputRoot -Force
Copy-Item -LiteralPath (Join-Path $sdkRoot 'License-Notices.txt') -Destination (Join-Path $outputRoot 'Discord-License-Notices.txt') -Force
Copy-Item -LiteralPath $jsonLicense -Destination (Join-Path $outputRoot 'JSON-LICENSE.MIT') -Force
& (Join-Path $outputRoot 'moewatch-discord.exe') --self-test
if ($LASTEXITCODE -ne 0) { throw 'Discord SDK load or credential self-test failed' }
