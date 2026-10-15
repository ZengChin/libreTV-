@echo off
rem ============================================================
rem  LibreTV 本地启动脚本
rem  用法：双击本文件，或在终端执行 start.cmd
rem  访问：http://localhost:3000   密码见 .env 的 PASSWORD
rem ============================================================

cd /d "%~dp0"

rem 必须清空 NODE_OPTIONS：沙箱/部分环境会注入 shim 劫持 fs.rm 导致安装或运行异常
set "NODE_OPTIONS="
set "NEXT_TELEMETRY_DISABLED=1"

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 node，请先安装 Node.js 18+ 并加入 PATH。
    pause
    exit /b 1
)

if not exist "node_modules\next\dist\bin\next" (
    echo [提示] 未检测到依赖，正在执行 npm install ...
    call npm install
    if errorlevel 1 (
        echo [错误] npm install 失败，请检查网络后重试。
        pause
        exit /b 1
    )
)

if not exist ".next" (
    echo [提示] 未检测到构建产物，正在执行 next build ...
    call node node_modules\next\dist\bin\next build
    if errorlevel 1 (
        echo [错误] 构建失败，请检查上方日志。
        pause
        exit /b 1
    )
)

echo.
echo ============================================================
echo   LibreTV 启动中 ...
echo   浏览器访问：http://localhost:3000
echo   停止服务：  Ctrl+C 或直接关闭本窗口
echo ============================================================
echo.

node node_modules\next\dist\bin\next start -p 3000

echo.
echo [服务已停止]
pause
