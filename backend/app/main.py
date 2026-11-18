from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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

# Register routes
app.include_router(contracts_router)

@app.on_event("startup")
def on_startup():
    init_db()

@app.get("/")
def health_check():
    return {
        "status": "online",
        "agent": "Contract Intelligence & Versioning Agent",
        "version": "1.0.0",
        "framework": "LangGraph + FastAPI + SQLite"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
