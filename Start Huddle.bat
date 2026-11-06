@echo off
rem ---------------------------------------------------------------------------
rem  Huddle launcher for Windows. Double-click to open Huddle in your browser.
rem
rem  First run: installs Python if it is missing (per-user, no admin needed)
rem  and adds a Huddle icon to your desktop. After that, just click the icon.
rem  Huddle keeps running in the background; use "Quit Huddle" in the app to stop.
rem ---------------------------------------------------------------------------
setlocal EnableExtensions
cd /d "%~dp0"
title Huddle

call :find_python
if defined PYEXE goto :launch

echo.
echo   Huddle needs Python, a free program from python.org.
echo   Installing it now. This takes a minute or two...
echo.
where winget >nul 2>nul
if errorlevel 1 goto :no_python
winget install --exact --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
call :find_python
if not defined PYEXE goto :no_python

:launch
if /i "%~1"=="debug" goto :debug
rem Use the window-less pythonw.exe so no black console window stays open.
set "PYW=%PYEXE:python.exe=pythonw.exe%"
if not exist "%PYW%" set "PYW=%PYEXE%"
start "" "%PYW%" "%~dp0huddle.py" --background --shortcut
exit /b 0

:debug
rem Troubleshooting mode: run Huddle in this window so any error stays visible.
echo.
echo   Starting Huddle in troubleshooting mode using:
echo   %PYEXE%
echo   Leave this window open while you use Huddle. Errors will appear below.
echo.
"%PYEXE%" "%~dp0huddle.py"
echo.
echo   Huddle has stopped. If you see an error above, copy it and send it along.
pause
exit /b 0

:find_python
set "PYEXE="
for %%C in ("py -3" "python" "python3") do call :try_python %%C
if defined PYEXE exit /b 0
rem winget installs here, and PATH is not refreshed until the next login.
for /d %%D in ("%LocalAppData%\Programs\Python\Python3*") do if exist "%%~D\python.exe" set "PYEXE=%%~D\python.exe"
exit /b 0

:try_python
if defined PYEXE exit /b 0
for /f "usebackq delims=" %%P in (`%~1 -c "import sys; print(sys.executable if sys.version_info >= (3, 9) else '')" 2^>nul`) do set "PYEXE=%%P"
rem Ignore anything that isn't a real file, e.g. the Microsoft Store "python" placeholder.
if defined PYEXE if not exist "%PYEXE%" set "PYEXE="
exit /b 0

:no_python
echo.
echo   Couldn't install Python automatically.
echo.
echo   1. Your browser is opening python.org. Download and run the installer,
echo      and tick "Add python.exe to PATH" on the first screen.
echo   2. Then double-click "Start Huddle.bat" again.
echo.
start "" "https://www.python.org/downloads/"
pause
exit /b 1
