param([switch]$Model, [switch]$Rules, [switch]$AssistOptions, [switch]$Headless, [switch]$Test, [switch]$Realistic, [switch]$Exceptions, [switch]$Demo, [string]$Url, [string]$Profile)
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if (-not $nodeCommand) { throw '请先安装 Node.js。' }
    if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/playwright'))) {
        $bundledPackages = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'
        if (Test-Path -LiteralPath (Join-Path $bundledPackages 'playwright')) { $env:NODE_PATH = $bundledPackages }
        else { throw '请先运行 npm install，然后运行 npx playwright install chromium。' }
    }
    if (-not $env:BROWSER_CHANNEL -and (Test-Path -LiteralPath 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')) { $env:BROWSER_CHANNEL = 'msedge' }
    & $nodeCommand.Source -e "try { const p=require('playwright'); if(!p.chromium) process.exit(1); require('playwright-core'); } catch { process.exit(1); }"
    if($LASTEXITCODE -ne 0){throw 'Playwright 依赖不完整，请在项目目录重新运行 npm install。'}
    if ($Test) { & $nodeCommand.Source --test tests/agent.test.cjs tests/model.test.cjs tests/ollama.test.cjs tests/realistic.test.cjs tests/exceptions.test.cjs tests/real-web.test.cjs tests/complex-controls.test.cjs tests/window.test.cjs }
    elseif ($Url) { $webArgs = @("real-web.cjs", $Url, $Profile); if ($Rules) { $webArgs += "--rules" }; if ($AssistOptions) { $webArgs += "--assist-options" }; & $nodeCommand.Source @webArgs }
    elseif ($Demo) { & $nodeCommand.Source demo.cjs }
    elseif ($Exceptions) { & $nodeCommand.Source evaluation/exceptions.cjs }
    else {
        $agentArguments = @('agent.cjs')
        if ($Model) { $agentArguments += '--model' }
        if ($Realistic) { $agentArguments += '--realistic' }
        if (-not $Headless) { $agentArguments += '--show' }
        & $nodeCommand.Source @agentArguments
    }
    if ($LASTEXITCODE -ne 0) { throw "执行未完成，退出码：$LASTEXITCODE" }
} finally { Pop-Location }
