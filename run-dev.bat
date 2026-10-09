@echo off
rem Start the app with hot reload (npm run dev) from the project folder.
cd /d "%~dp0"

if not exist node_modules (
  echo node_modules not found, running npm install first...
  call npm install
  if errorlevel 1 exit /b %errorlevel%
)

call npm run dev
