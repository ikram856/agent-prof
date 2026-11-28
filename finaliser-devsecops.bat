@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MEHDI 2.0 - Finalisation DevSecOps
echo.
echo ===== 1/5  Installation du dossier .github (pipeline + Dependabot)
if not exist "_github\workflows\devsecops.yml" (
  if exist ".github\workflows\devsecops.yml" ( echo Deja installe. ) else ( echo ERREUR : dossier _github introuvable. & goto :fin )
) else (
  xcopy "_github" ".github" /E /I /Y >nul || ( echo ERREUR pendant la copie de .github & goto :fin )
  rmdir /S /Q "_github"
  echo OK
)
echo.
echo ===== 2/5  Versions exactes des dependances (package-lock.json)
call npm install --save-exact jszip@latest unpdf@latest || ( echo ERREUR pendant npm install & goto :fin )
echo.
echo ===== 3/5  Tests automatiques
call npm test || ( echo. & echo LES TESTS ONT ECHOUE : rien n'est envoye sur GitHub. & goto :fin )
echo.
echo ===== 4/5  Verification : aucun fichier prive ne doit partir
git add .
git diff --cached --name-only > "%TEMP%\mehdi-fichiers.txt"
findstr /X /L /C:".env" "%TEMP%\mehdi-fichiers.txt" >nul && goto :prive
findstr /B /L /C:"data/" /C:"cours/" /C:"conversations/" /C:"node_modules/" "%TEMP%\mehdi-fichiers.txt" >nul && goto :prive
echo Fichiers envoyes :
type "%TEMP%\mehdi-fichiers.txt"
echo.
echo ===== 5/5  Envoi sur GitHub
git commit -m "DevSecOps : pipeline de sécurité, tests automatiques, CSP, protection SSRF et CSRF" || ( echo Rien a envoyer. & goto :fin )
git push || ( echo ERREUR pendant git push & goto :fin )
echo.
echo ==========================================================
echo  TERMINE ! Ouvre l'onglet Actions de ton depot sur GitHub.
echo ==========================================================
goto :fin

:prive
git reset >nul
echo.
echo ERREUR : un fichier prive (.env, data, cours...) allait etre envoye. RIEN n'a ete envoye.

:fin
echo.
pause
