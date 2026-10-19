@echo off
rem DeadChat's ComfyUI server. Started hidden at logon by start-comfyui-hidden.vbs
rem (Startup folder). Restarts automatically if ComfyUI exits or crashes.
rem Models/outputs: C:\Users\defie\ComfyUI-Shared   Log: ..\comfyui-service.log
cd /d "%~dp0ComfyUI\ComfyUI"
:loop
echo [%date% %time%] starting ComfyUI >> "%~dp0comfyui-service.log"
"%~dp0ComfyUI\standalone-env\python.exe" main.py --listen 0.0.0.0 --port 8188 --base-directory "C:\Users\defie\ComfyUI-Shared" >> "%~dp0comfyui-service.log" 2>&1
echo [%date% %time%] ComfyUI exited with %errorlevel%, restarting in 10s >> "%~dp0comfyui-service.log"
timeout /t 10 /nobreak >nul
goto loop
