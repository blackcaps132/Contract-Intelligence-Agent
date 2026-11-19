import sys
from pathlib import Path
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BASE_DIR))

from app.main import app

client = TestClient(app)

def test_api():
    print("Testing FastAPI Endpoints...")
    
    # 1. GET /api/contracts
    res = client.get("/api/contracts")
    assert res.status_code == 200
    contracts = res.json()
    print(f"GET /api/contracts: {len(contracts)} contracts returned.")

    contract_id = "sow_001_cloud_migration"

    # 2. GET /api/contracts/{id}
    res = client.get(f"/api/contracts/{contract_id}")
    assert res.status_code == 200
    print(f"GET /api/contracts/{contract_id}: version = {res.json()['current_version']}")

    # 3. POST /api/contracts/{id}/propose-amendment
    res = client.post(
        f"/api/contracts/{contract_id}/propose-amendment",
        json={"instruction": "Change payment terms to Net 60"}
    )
    assert res.status_code == 200
    prop = res.json()
    print(f"POST /propose-amendment: proposed version = {prop['proposed_version']}, diffs = {len(prop['diffs'])}")

    # 4. GET /api/contracts/{id}/history
    res = client.get(f"/api/contracts/{contract_id}/history")
    assert res.status_code == 200
    history = res.json()
    print(f"GET /history: {len(history)} commits in log.")

    # 5. GET /api/contracts/{id}/export
    res = client.get(f"/api/contracts/{contract_id}/export")
    assert res.status_code == 200
    assert len(res.content) > 1000
    print(f"GET /export: {len(res.content)} bytes returned (Content-Type: {res.headers.get('content-type')}).")

    print("ALL API ENDPOINTS TESTED SUCCESSFULLY!")

if __name__ == "__main__":
    test_api()
