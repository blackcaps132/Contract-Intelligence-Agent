import sys
from pathlib import Path

# Ensure backend directory is in sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from app.api.routes import router as contracts_router
from app.database import init_db

app = FastAPI(
    title="Contract Intelligence & Versioning Agent API",
    description="Agentic contract lifecycle copilot featuring Intake & Checklist Verification, Vector Q&A, and Git-style Version Tracking.",
    version="1.0.0"
)

# Enable CORS for Frontend (Vite/React on localhost:5173 or localhost:3000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API routes
app.include_router(contracts_router)

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "agent": "Contract Intelligence & Versioning Agent",
        "version": "1.0.0",
        "framework": "LangGraph + FastAPI + SQLite + ChromaDB"
    }

# Mount built frontend SPA static files if available
dist_dir = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(dist_dir), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, app_dir=str(BASE_DIR), reload=True)
