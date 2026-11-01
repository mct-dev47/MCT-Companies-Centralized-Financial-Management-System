import os
import sys
import time

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
sys.path.insert(0, "backend")

print("1. Importing modules...", flush=True)
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.dependencies import get_current_user
from app.api.v1.endpoints import bills

print("2. Setting up FastAPI...", flush=True)
app = FastAPI()
app.include_router(bills.router, prefix="/bills")
app.dependency_overrides[get_current_user] = lambda: {"role": "admin", "is_admin": True, "company_ids": []}

client = TestClient(app)

print("3. Sending GET /bills as Admin...", flush=True)
start = time.time()
res = client.get("/bills")
print(f"4. Result in {time.time() - start:.2f}s: status={res.status_code}, json={res.json()}", flush=True)
