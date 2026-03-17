@echo off
title Alpha Bot - First Time Setup
color 0A

echo.
echo  ============================================
echo    ALPHA WHATSAPP BOT - FIRST TIME SETUP
echo  ============================================
echo.
echo  This will take 2-5 minutes.
echo  Please keep this window open!
echo.
echo  Installing bot components...
echo.

cd /d "%~dp0"

call npm install

if %errorlevel% neq 0 (
    color 0C
    echo.
    echo  ============================================
    echo    ERROR: Installation failed!
    echo  ============================================
    echo.
    echo  Please make sure Node.js is installed.
    echo  Download it from: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo.
echo  ============================================
echo    SETUP COMPLETE!
echo  ============================================
echo.
echo  You only need to run this file ONCE.
echo.
echo  From now on, use "START BOT.bat" to run the bot.
echo.
echo  Starting the bot now for the first time...
echo.
pause

call node index.js
