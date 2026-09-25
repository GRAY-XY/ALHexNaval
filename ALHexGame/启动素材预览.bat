@echo off
cd /d "%~dp0"
py -3 "%~dp0tools\serve_preview.py" --open
if errorlevel 1 pause
