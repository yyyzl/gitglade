param([Parameter(ValueFromRemainingArguments = $true)][string[]]$LaunchArguments)
# Compatibility alias scoped to this GitGlade installation.
& (Join-Path $PSScriptRoot 'gitglade.ps1') @LaunchArguments
exit $LASTEXITCODE
