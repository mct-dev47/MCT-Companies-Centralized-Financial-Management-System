Write-Host "Starting MCT FastAPI Backend..." -ForegroundColor Cyan
& "..\.venv\Scripts\uvicorn.exe" app.main:app --reload --host 127.0.0.1 --port 8001
