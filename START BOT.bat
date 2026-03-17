@echo off
title Alpha Bot - Running
color 0A

echo.
echo  ============================================
echo    ALPHA WHATSAPP BOT
echo  ============================================
echo.
echo  Starting bot... please wait.
echo.
echo  A QR code will appear below.
echo  Scan it with your WhatsApp Business app:
echo    - Open WhatsApp Business on your phone
echo    - Tap the 3 dots (top right)
echo    - Tap "Linked Devices"
echo    - Tap "Link a Device"
echo    - Point camera at the QR code
echo.
echo  (You only need to scan ONCE - after that it
echo   remembers your account automatically!)
echo.
echo  To stop the bot: press Ctrl + C
echo.
echo  ============================================
echo.

cd /d "%~dp0"

node index.js

echo.
echo  Bot has stopped. Close this window or
echo  double-click START BOT.bat to restart.
echo.
pause
