@echo off
cd /d "%~dp0"
title Serveur agent-prof
node --env-file=.env server.mjs
pause
