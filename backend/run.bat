@echo off
echo Starting MCT FastAPI Backend...
call ..\.venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8001
pause
