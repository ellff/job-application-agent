param([switch]$AssistOptions, [string]$Profile = '.\.local\personal-profile.json')
$ErrorActionPreference = 'Stop'
$targetUrl = 'https://xiaoyuan.zhaopin.com/'
& (Join-Path $PSScriptRoot 'start.ps1') -Rules -AssistOptions:$AssistOptions -Url $targetUrl -Profile $Profile
