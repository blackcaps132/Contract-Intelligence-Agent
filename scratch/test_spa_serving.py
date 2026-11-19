import sys
from pathlib import Path
from fastapi.testclient import TestClient

BASE_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BASE_DIR))

from app.main import app

client = TestClient(app)

def test_spa():
    # Test health check
    res_health = client.get("/api/health")
    assert res_health.status_code == 200
    print("Health check response:", res_health.json())

    # Test root SPA serve
    res_root = client.get("/")
    assert res_root.status_code == 200
    assert "Contract Intelligence" in res_root.text
    print("Root SPA served successfully! HTML length:", len(res_root.text))

    print("ALL SPA TESTS PASSED!")

if __name__ == "__main__":
    test_spa()
