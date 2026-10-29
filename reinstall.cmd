@echo off
chcp 65001 >nul
setlocal EnableExtensions

rem One-click reinstall/update for the dsh-db plugin (0.3.4).
rem 1. Packs the workspace into dsh-db-0.3.4.tgz.
rem 2. Installs it into the desktop profile with the app's bundled dsh.
rem 3. If any of that fails, copies lib/ + package.json straight into the
rem    installed package so the new code still loads after a restart.
rem Uses the Node/pnpm/CLI bundled with DSH Desktop; no global PATH needed.

set "PLUGIN=%~dp0"
set "PROFILE=%USERPROFILE%\.dsh\profiles\desktop"
set "INSTALLED=%PROFILE%\node_modules\dsh-db"

set "APP_ROOT=D:\Program Files\DeepSeek Harness"
if not exist "%APP_ROOT%\DeepSeek Harness.exe" set "APP_ROOT=%LOCALAPPDATA%\Programs\DeepSeek Harness"
if not exist "%APP_ROOT%\DeepSeek Harness.exe" set "APP_ROOT=C:\Program Files\DeepSeek Harness"

set "NODE=%APP_ROOT%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
set "PNPM=%APP_ROOT%\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs"
set "DSH=%APP_ROOT%\resources\runtime\cli\bin\dsh.cmd"
set "TARBALL=%PLUGIN%dsh-db-0.3.4.tgz"

echo.
echo === dsh-db 0.3.4 reinstall ===
echo Plugin:  %PLUGIN%
echo Profile: %PROFILE%
echo.

cd /d "%PLUGIN%"
if errorlevel 1 goto :fallback

if exist "%NODE%" if exist "%PNPM%" goto :pack
echo [WARN] bundled node/pnpm not found; skipping pack.
goto :fallback

:pack
echo [1/2] Packing %TARBALL% ...
"%NODE%" "%PNPM%" pack
if errorlevel 1 (
  echo [WARN] pnpm pack failed; using the direct-copy fallback.
  goto :fallback
)
if not exist "%TARBALL%" (
  echo [WARN] tarball was not created; using the direct-copy fallback.
  goto :fallback
)

echo.
echo [2/2] Installing into the desktop profile ...
if exist "%DSH%" (
  call "%DSH%" plugin --profile desktop add "%TARBALL%"
  if not errorlevel 1 goto :success
  echo.
  echo [WARN] add failed; retrying with remove + add ...
  call "%DSH%" plugin --profile desktop remove dsh-db
  call "%DSH%" plugin --profile desktop add "%TARBALL%"
  if not errorlevel 1 goto :success
)
echo.
echo [WARN] dsh plugin install failed; using the direct-copy fallback.
goto :fallback

:fallback
if not exist "%INSTALLED%" (
  echo [ERROR] Installed package not found: %INSTALLED%
  goto :fail
)
echo.
echo Copying lib\ and package.json into the installed package ...
xcopy /E /I /Y "%PLUGIN%lib" "%INSTALLED%\lib" >nul
if errorlevel 1 goto :fail
copy /Y "%PLUGIN%package.json" "%INSTALLED%\package.json" >nul
if errorlevel 1 goto :fail
copy /Y "%PLUGIN%cordis.patch.yml" "%INSTALLED%\cordis.patch.yml" >nul
copy /Y "%PLUGIN%README.md" "%INSTALLED%\README.md" >nul
copy /Y "%PLUGIN%README.en.md" "%INSTALLED%\README.en.md" >nul
echo Copied. The installed package now contains 0.3.4 code.
echo.
echo [DONE] Quit DSH Desktop from the tray and start it again.
echo        Then open the Database panel. SQL completion and "Ask agent" are active.
echo.
pause
exit /b 0

:success
echo.
echo [DONE] Installed dsh-db 0.3.4.
echo        Quit DSH Desktop from the tray and start it again.
echo        Then open the Database panel. SQL completion and "Ask agent" are active.
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] Reinstall failed. Copy everything above and send it back.
echo.
pause
exit /b 1
