@echo off
setlocal
cd /d "%~dp0"
title AI QA Studio - Client Demo
set "STUDIO_NODE=%~dp0runtime\node\node.exe"
if not exist "%STUDIO_NODE%" set "STUDIO_NODE=node"
"%STUDIO_NODE%" "%~dp0scripts\desktop.cjs" start --demo
if errorlevel 1 pause
