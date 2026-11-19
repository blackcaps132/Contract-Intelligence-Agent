import json
import uuid
from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Response
from fastapi.responses import FileResponse, StreamingResponse
from typing import List, Optional

from app.database import get_db
from app.models.schemas import (
    ContractListItem,
    ContractDetailResponse,
    AnalysisResponse,
    ChecklistItem,
    RiskFlag,
    ContractMetadata,
    QARequest,
    QAResponse,
    Citation,
    ConflictReport,
    ConflictItem,
    AmendmentProposalRequest,
    AmendmentProposalResponse,
    CommitRequest,
    CommitResponse,
    VersionHistoryItem,
    VersionDiffRecord,
    RollbackRequest,
    ClauseDiff
)
from app.graphs.analysis_graph import analysis_agent
from app.graphs.qa_conflict_graph import qa_conflict_agent
from app.graphs.amendment_graph import amendment_agent
from app.services.vector_service import index_contract, index_all_contracts_in_db, query_contract_clauses
from app.services.conflict_service import simulate_cross_clause_conflict
from app.services.parser_service import extract_text_from_file
from app.services.version_service import (
    commit_contract_version,
    get_contract_version_history,
    rollback_contract_version
)
from app.services.export_service import generate_contract_docx

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
        status=final_state.get("status", "Completed"),
        checklist_score=final_state["checklist_score"],
        checklist_items=checklist_items,
        risk_flags=risk_flags,
        metadata=metadata,
        executive_summary=final_state["executive_summary"]
    )

@router.post("/{contract_id}/qa", response_model=QAResponse)
def ask_contract_question(contract_id: str, request: QARequest):
    """
    Executes LangGraph Q&A & Conflict Simulator graph.
    - If user asks a question (deadlines, rates), returns grounded answer with section citations.
    - If user proposes a change ('What if I change payment to Net 60?'), detects cross-clause conflicts!
    """
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM contracts WHERE id = ?", (contract_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Contract not found")

    initial_state = {
        "contract_id": contract_id,
        "user_query": request.query,
        "query_type": "",
        "retrieved_chunks": [],
        "answer": "",
        "citations": [],
        "conflict_report": None
    }

    final_state = qa_conflict_agent.invoke(initial_state)

    citations = [Citation(**c) for c in final_state["citations"]]
    conflict_rep = None
    if final_state.get("conflict_report"):
        cr = final_state["conflict_report"]
        conflict_rep = ConflictReport(
            status=cr["status"],
            severity=cr["severity"],
            proposed_change=cr["proposed_change"],
            conflict_count=cr["conflict_count"],
            conflicts=[ConflictItem(**c) for c in cr["conflicts"]],
            recommendations=cr["recommendations"],
            analyzed_clauses=cr["analyzed_clauses"]
        )

    return QAResponse(
        contract_id=contract_id,
        query=request.query,
        query_type=final_state["query_type"],
        answer=final_state["answer"],
        citations=citations,
        conflict_report=conflict_rep
    )

@router.post("/{contract_id}/simulate-conflict", response_model=ConflictReport)
def simulate_conflict(contract_id: str, request: QARequest):
    """Direct endpoint to simulate a contemplated contract change and report cross-clause contradictions."""
    report = simulate_cross_clause_conflict(contract_id, request.query)
    return ConflictReport(
        status=report["status"],
        severity=report["severity"],
        proposed_change=report["proposed_change"],
        conflict_count=report["conflict_count"],
        conflicts=[ConflictItem(**c) for c in report["conflicts"]],
        recommendations=report["recommendations"],
        analyzed_clauses=report["analyzed_clauses"]
    )

@router.post("/reindex")
def reindex_all_contracts():
    """Indexes all contracts currently in SQLite into the ChromaDB vector database."""
    stats = index_all_contracts_in_db()
    total_chunks = sum(stats.values())
    return {
        "status": "success",
        "contracts_indexed": len(stats),
        "total_chunks": total_chunks,
        "details": stats
    }

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
        VALUES (?, ?, ?, ?, 'v1.0', 'Pending Review', ?)
        """, (contract_id, doc_title, doc_counterparty, contract_type, json.dumps(metadata)))

        version_id = f"ver_init_{contract_id[:8]}_{uuid.uuid4().hex[:6]}"
        cursor.execute("""
        INSERT INTO contract_versions (version_id, contract_id, version_tag, author_name, commit_message, full_content, changelog_summary)
        VALUES (?, ?, 'v1.0', 'Uploader / Legal Intake', 'Initial contract ingestion', ?, 'Uploaded baseline document.')
        """, (version_id, contract_id, extracted_text))
        
        conn.commit()

    # Automatically index newly uploaded contract into ChromaDB
    chunk_count = index_contract(contract_id, doc_title, extracted_text)

    return {
        "contract_id": contract_id,
        "title": doc_title,
        "version": "v1.0",
        "chunks_indexed": chunk_count,
        "status": "Ingested",
        "message": "Contract uploaded, registered with v1.0, and indexed into ChromaDB."
    }

# --- Phase 4: Module 3 Smart Modifications & Git-Style Versioning Endpoints ---

@router.post("/{contract_id}/propose-amendment", response_model=AmendmentProposalResponse)
def propose_amendment(contract_id: str, request: AmendmentProposalRequest):
    """
    LangGraph Workflow Node 1:
    Parses conversational amendment instruction, locates affected clauses,
    drafts proposed replacement, and calculates visual redline diffs.
    """
    initial_state = {
        "contract_id": contract_id,
        "instruction": request.instruction,
        "author_name": request.author_name or "Legal Counsel",
        "commit_message": None,
        "proposal_id": "",
        "summary_of_changes": "",
        "diffs": [],
        "proposed_version": "",
        "proposed_content": "",
        "warnings": [],
        "approved": False,
        "version_id": None,
        "error": None
    }

    final_state = amendment_agent.invoke(initial_state)

    if final_state.get("error"):
        raise HTTPException(status_code=400, detail=final_state["error"])

    diff_objects = [
        ClauseDiff(
            section_number=d["section_number"],
            section_title=d["section_title"],
            before_text=d["before_text"],
            after_text=d["after_text"],
            diff_html=d.get("diff_html", ""),
            rationale=d["rationale"]
        )
        for d in final_state["diffs"]
    ]

    return AmendmentProposalResponse(
        contract_id=contract_id,
        proposal_id=final_state["proposal_id"],
        instruction=request.instruction,
        summary_of_changes=final_state["summary_of_changes"],
        diffs=diff_objects,
        proposed_version=final_state["proposed_version"],
        proposed_content=final_state["proposed_content"],
        warnings=final_state["warnings"]
    )

@router.post("/{contract_id}/commit", response_model=CommitResponse)
def commit_amendment(contract_id: str, request: CommitRequest):
    """
    LangGraph Workflow Node 2 (Human Approval Gate):
    Commits approved modifications as a new Git-style version (e.g. v1.0 -> v1.1).
    Records author, commit message, snapshot, and clause-level diff audit history.
    """
    diff_dicts = [d.dict() for d in request.diffs]
    try:
        res = commit_contract_version(
            contract_id=contract_id,
            author_name=request.author_name,
            commit_message=request.commit_message,
            updated_content=request.updated_content,
            changelog_summary=request.changelog_summary or "",
            diffs=diff_dicts
        )
        return CommitResponse(**res)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{contract_id}/history", response_model=List[VersionHistoryItem])
def get_version_history(contract_id: str):
    """Retrieves full Git-style commit log tree with author, timestamp, message, and clause diffs."""
    try:
        history = get_contract_version_history(contract_id)
        result = []
        for v in history:
            diff_records = [
                VersionDiffRecord(
                    id=d["id"],
                    section_number=d["section_number"],
                    section_title=d["section_title"],
                    before_text=d["before_text"],
                    after_text=d["after_text"],
                    rationale=d["rationale"]
                )
                for d in v.get("diffs", [])
            ]
            result.append(
                VersionHistoryItem(
                    version_id=v["version_id"],
                    contract_id=v["contract_id"],
                    version_tag=v["version_tag"],
                    author_name=v["author_name"],
                    commit_message=v["commit_message"],
                    changelog_summary=v["changelog_summary"] or "",
                    created_at=v["created_at"],
                    is_current=v["is_current"],
                    diffs=diff_records
                )
            )
        return result
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))

@router.post("/{contract_id}/rollback/{target_version_id}", response_model=CommitResponse)
def rollback_version(contract_id: str, target_version_id: str, request: RollbackRequest):
    """
    Rolls back contract to a prior historical version state, creating a new auditable commit tag.
    """
    try:
        res = rollback_contract_version(
            contract_id=contract_id,
            target_version_id=target_version_id,
            author_name=request.author_name or "Legal Counsel",
            reason=request.reason or "Rollback to previous approved state"
        )
        return CommitResponse(**res)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{contract_id}/export")
def export_contract_docx(contract_id: str, version_tag: Optional[str] = None):
    """
    Generates and downloads a clean, styled Microsoft Word (.docx) document
    for the specified version (or active version).
    """
    try:
        stream = generate_contract_docx(contract_id, version_tag)
        filename = f"Contract_{contract_id}_{version_tag or 'current'}.docx"
        return StreamingResponse(
            stream,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'}
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

