@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   LawDesk AI - 律师个人智能业务管理工作台
echo   --------------------------------------------
echo   正在启动本机服务，请勿关闭此窗口。
echo   启动后在浏览器打开： http://127.0.0.1:8765
echo   默认账号：admin   默认密码：lawdesk
echo   数据保存在 data\ 目录，页面刷新后依然保留。
echo.
where python >nul 2>nul
if %errorlevel%==0 (
  python server.py
) else (
  where py >nul 2>nul
  if %errorlevel%==0 ( py -3 server.py ) else ( echo 未找到 Python，请先安装 Python 3.9 及以上版本。 )
)
echo.
echo   服务已停止。按任意键关闭窗口。
pause >nul
