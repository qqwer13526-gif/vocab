@echo off
rem Start the local server and open the app in the default browser.
rem Service workers / PWA install only work over http(s), so open via localhost.
rem The browser is opened 2 seconds later, otherwise it may beat the server and show "can't connect".
cd /d "%~dp0"
echo.
echo   Bei Dan Ci (vocab PWA) - local server
echo   http://127.0.0.1:5173
echo.
echo   Keep this window open while you use the app. Press Ctrl+C to stop.
echo.
start "" cmd /c "timeout /t 2 /nobreak >nul && start "" http://127.0.0.1:5173"
python tool\serve.py 5173
pause
