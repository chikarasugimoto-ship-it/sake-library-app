@echo off
cd /d "%~dp0"
set PATH=C:\Users\mirai\tools\node-v24.16.0-win-x64;%PATH%
call npm.cmd run dev -- --port 3888 -H 0.0.0.0
