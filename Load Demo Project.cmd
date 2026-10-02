@echo off
setlocal
cd /d "%~dp0"
set "STUDIO_NODE=%~dp0runtime\node\node.exe"
if not exist "%STUDIO_NODE%" set "STUDIO_NODE=node"
"%STUDIO_NODE%" "%~dp0scripts\demo-project.cjs"
if errorlevel 1 pause
