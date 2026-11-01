$ErrorActionPreference='Stop'
Push-Location $PSScriptRoot
try {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw '请先安装 Node.js' }
    if (-not (Test-Path 'node_modules/playwright')) {
        $bundledPackages=Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
        if(Test-Path (Join-Path $bundledPackages 'playwright')){$env:NODE_PATH=$bundledPackages}
        else {throw '请先在项目目录运行 npm install 和 npx playwright install chromium'}
    }
    & node -e "try { const p=require('playwright'); if(!p.chromium) process.exit(1); require('playwright-core'); } catch { process.exit(1); }"
    if($LASTEXITCODE -ne 0){throw 'Playwright 依赖不完整。请在项目目录重新运行 npm install；仅存在 node_modules/playwright 文件夹不代表安装成功。'}
    if(-not $env:BROWSER_CHANNEL -and (Test-Path 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')){$env:BROWSER_CHANNEL='msedge'}
    $logDirectory=Join-Path $PSScriptRoot '.local'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $startupLog=Join-Path $logDirectory 'window-startup.log'
    # Windows PowerShell can treat native stderr as a terminating error.
    # Capture it so the actual browser failure survives the hidden launcher.
    $previousErrorPreference=$ErrorActionPreference
    try {
        $ErrorActionPreference='Continue'
        & node window.cjs *> $startupLog
        $windowExitCode=$LASTEXITCODE
    } finally {$ErrorActionPreference=$previousErrorPreference}
    if($windowExitCode -ne 0){
        $details=(Get-Content -LiteralPath $startupLog -Tail 18 -ErrorAction SilentlyContinue) -join "`n"
        if(-not $details){$details="程序退出码：$windowExitCode"}
        throw "窗口启动或运行失败。`n$details`n`n完整日志：$startupLog"
    }
} catch {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'网申辅助填写') | Out-Null
} finally {Pop-Location}
