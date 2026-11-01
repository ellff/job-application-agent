param([string]$Profile = '.\.local\personal-profile.json')
$ErrorActionPreference = 'Stop'
$previousProvider = $env:OPTION_MODEL_PROVIDER
$previousToken = $env:SINOMACH_API_KEY
try {
    if (-not $env:SINOMACH_API_KEY) {
        $secret = Read-Host '请输入集团模型 Token（输入隐藏，可直接粘贴）' -AsSecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
        try { $env:SINOMACH_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secret.Dispose() }
    }
    if (-not $env:SINOMACH_API_KEY.Trim()) { throw 'Token 不能为空' }
    $env:OPTION_MODEL_PROVIDER = 'sinomach'
    & (Join-Path $PSScriptRoot 'try-zhaopin.ps1') -AssistOptions -Profile $Profile
} finally {
    $env:OPTION_MODEL_PROVIDER = $previousProvider
    $env:SINOMACH_API_KEY = $previousToken
}