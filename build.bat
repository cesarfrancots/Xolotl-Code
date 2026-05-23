@echo off
REM Production rebuild + refresh root-level xolotl.exe.
REM Run this whenever you want the desktop shortcut to launch the latest code.

setlocal
cd /d "%~dp0tauri-app"
call npm run tauri build || exit /b 1
copy /Y "src-tauri\target\release\xolotl.exe" "..\xolotl.exe" >nul
echo.
echo Built: %~dp0xolotl.exe
echo Desktop shortcut "Xolotl Code" launches the same binary.
endlocal
