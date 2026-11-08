@echo off
rem deadchat medical model service on port 8790 (see README.md)
cd /d %~dp0
if not exist .venv (
  py -3.13 -m venv .venv --system-site-packages
  .venv\Scripts\python -m pip install -r requirements.txt
)
.venv\Scripts\python -m uvicorn server:app --host 0.0.0.0 --port 8790
