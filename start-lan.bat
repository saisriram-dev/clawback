@echo off
rem Starts ClawBack shared on your local network, so buyers or colleagues on the same
rem network can open the response links. Windows may ask to allow Node.js through the firewall.
cd /d "%~dp0"
call start.bat --lan
