@echo off
rem Sube los cambios de la app a GitHub; la web (GitHub Pages) se actualiza en 1-2 minutos.
cd /d "%~dp0"
git add -A
git commit -m "Actualizacion %date% %time%"
git push
pause
