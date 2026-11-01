param([switch]$Test, [string]$Profile = '.\.local\personal-profile.json')
$ErrorActionPreference='Stop'
$previousProvider=$env:OPTION_MODEL_PROVIDER
try {
  $env:OPTION_MODEL_PROVIDER='ollama'
  if($Test){ & node (Join-Path $PSScriptRoot 'test-ollama.cjs') }
  else { & (Join-Path $PSScriptRoot 'try-zhaopin.ps1') -AssistOptions -Profile $Profile }
} finally { $env:OPTION_MODEL_PROVIDER=$previousProvider }