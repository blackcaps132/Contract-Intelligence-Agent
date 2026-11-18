import json
import uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from typing import List

from app.database import get_db
from app.models.schemas import (
    ContractListItem,
    ContractDetailResponse,
    AnalysisResponse,
    ChecklistItem,
    RiskFlag,
    ContractMetadata
)
from app.graphs.analysis_graph import analysis_agent
from app.services.parser_service import extract_text_from_file

router = APIRouter(prefix="/api/contracts", tags=["Contracts"])

@router.get("", response_model=List[ContractListItem])
def list_contracts():
    """Returns all contracts stored in the database repository."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT id, title, counterparty, contract_type, current_version, status, checklist_score, created_at, updated_at
        FROM contracts
        ORDER BY updated_at DESC
        """)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

@router.get("/{contract_id}", response_model=ContractDetailResponse)
def get_contract(contract_id: str):
    """Retrieves contract details, parsed checklist items, risk flags, and current version text."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT c.*, v.full_content, v.version_tag
        FROM contracts c
        JOIN contract_versions v ON c.id = v.contract_id AND c.current_version = v.version_tag
        WHERE c.id = ?
        """, (contract_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Contract not found")
            
        checklist_items = json.loads(row["checklist_json"] or "[]")
        risk_flags = json.loads(row["risk_flags_json"] or "[]")
        metadata = json.loads(row["metadata_json"] or "{}")

        return ContractDetailResponse(
            id=row["id"],
            title=row["title"],
            counterparty=row["counterparty"],
            contract_type=row["contract_type"],
            current_version=row["current_version"],
            status=row["status"],
            checklist_score=row["checklist_score"] or "Pending Analysis",
            checklist_items=[ChecklistItem(**item) for item in checklist_items],
            risk_flags=[RiskFlag(**item) for item in risk_flags],
            metadata=ContractMetadata(**metadata) if metadata else ContractMetadata(),
            content=row["full_content"],
            created_at=row["created_at"],
            updated_at=row["updated_at"]
        )

@router.post("/{contract_id}/analyze", response_model=AnalysisResponse)
def analyze_contract(contract_id: str):
    """Executes the LangGraph Analysis & Mandatory Checklist verification graph."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT c.*, v.full_content
        FROM contracts c
        JOIN contract_versions v ON c.id = v.contract_id AND c.current_version = v.version_tag
        WHERE c.id = ?
        """, (contract_id,))
        row = cursor.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="Contract not found")
            
        initial_state = {
            "contract_id": row["id"],
            "raw_content": row["full_content"],
            "file_type": "text",
            "title": row["title"],
            "counterparty": row["counterparty"],
            "contract_type": row["contract_type"],
            "sections": {},
            "metadata": {},
            "checklist_items": [],
            "checklist_score": "",
            "risk_flags": [],
            "executive_summary": "",
            "error": None
        }

    # Execute LangGraph Analysis Agent
    final_state = analysis_agent.invoke(initial_state)

    checklist_items = [ChecklistItem(**item) for item in final_state["checklist_items"]]
    risk_flags = [RiskFlag(**item) for item in final_state["risk_flags"]]
    metadata = ContractMetadata(**final_state["metadata"])

    return AnalysisResponse(
        contract_id=final_state["contract_id"],
        title=final_state["title"],
        contract_type=final_state["metadata"].get("contract_type", final_state["contract_type"]),
        current_version=row["current_version"],
        checklist_score=final_state["checklist_score"],
        checklist_items=checklist_items,
        risk_flags=risk_flags,
        metadata=metadata,
        executive_summary=final_state["executive_summary"]
    )

@router.post("/upload")
async def upload_contract(
    file: UploadFile = File(...),
    title: str = Form(None),
    counterparty: str = Form(None),
    contract_type: str = Form("Commercial Contract")
):
    """Ingests a new contract file (PDF, Word, TXT, MD) and registers it in the database with v1.0."""
    temp_dir = Path("backend/data/uploads")
    temp_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = temp_dir / file.filename
    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    try:
        extracted_text = extract_text_from_file(file_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse uploaded document: {str(e)}")

    contract_id = f"cnt_{uuid.uuid4().hex[:8]}"
    doc_title = title or file.filename.rsplit(".", 1)[0].replace("_", " ")
    doc_counterparty = counterparty or "Pending Review"

    metadata = {
        "title": doc_title,
        "counterparty": doc_counterparty,
        "contract_type": contract_type,
        "uploaded_filename": file.filename
    }

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        INSERT INTO contracts (id, title, counterparty, contract_type, current_version, status, metadata_json)
        VALUES (?, ?, ?, ?, 'v1.0', 'Active', ?)
        """, (contract_id, doc_title, doc_counterparty, contract_type, json.dumps(metadata)))

        version_id = f"ver_init_{contract_id[:8]}_{uuid.uuid4().hex[:6]}"
        cursor.execute("""
        INSERT INTO contract_versions (version_id, contract_id, version_tag, author_name, commit_message, full_content, changelog_summary)
        VALUES (?, ?, 'v1.0', 'Uploader / Legal Intake', 'Initial contract ingestion', ?, 'Uploaded baseline document.')
        """, (version_id, contract_id, extracted_text))
        
        conn.commit()

    return {
        "contract_id": contract_id,
        "title": doc_title,
        "version": "v1.0",
        "status": "Ingested",
        "message": "Contract uploaded and registered with v1.0 version tracking."
    }
