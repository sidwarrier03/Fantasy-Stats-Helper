@echo off
cd /d "%~dp0"
py -3 huddle.py %* || python huddle.py %*
pause
