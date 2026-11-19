param(
    [Parameter(Mandatory = $true)][string]$WorkspaceRoot,
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
$packageRootPath = (Resolve-Path -LiteralPath $WorkspaceRoot).Path.TrimEnd('\') + '\'
$packageSourcePath = (Resolve-Path -LiteralPath $Source).Path
$packageTargetPath = [System.IO.Path]::GetFullPath($Destination)
if (-not $packageSourcePath.StartsWith($packageRootPath, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not $packageTargetPath.StartsWith($packageRootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Package target escapes workspace'
}
if (Test-Path -LiteralPath $packageTargetPath) { throw 'Package destination already exists' }
Move-Item -LiteralPath $packageSourcePath -Destination $packageTargetPath
