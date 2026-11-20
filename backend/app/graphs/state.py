from typing import TypedDict, List, Dict, Any, Optional

class AnalysisGraphState(TypedDict):
    """LangGraph state schema for Contract Intake & Mandatory Checklist Analysis."""
    contract_id: str
    raw_content: str
    file_type: str                  # txt, docx, pdf, md
    title: str
    counterparty: str
    contract_type: str
    sections: Dict[str, str]        # {"SECTION 1. ...": "content...", "SECTION 2. ...": "content..."}
    metadata: Dict[str, Any]        # effective_date, expiration_date, total_value, governing_law
    checklist_items: List[Dict[str, Any]]
    checklist_score: str            # e.g., "6/6 Passed (100%)"
    risk_flags: List[Dict[str, Any]]
    executive_summary: str
    status: Optional[str]
    error: Optional[str]

class QAConflictGraphState(TypedDict):
    """LangGraph state schema for Vector RAG Q&A and What-If Conflict Simulator."""
    contract_id: str
    user_query: str
    query_type: str                  # "QUESTION" or "PROPOSED_CHANGE"
    retrieved_chunks: List[Dict[str, Any]]
    answer: str
    citations: List[Dict[str, Any]]
    conflict_report: Optional[Dict[str, Any]]

class AmendmentGraphState(TypedDict):
    """LangGraph state schema for Smart Modifications & Redline Version Control."""
    contract_id: str
    instruction: str
    author_name: str
    commit_message: Optional[str]
    suggested_commit_message: Optional[str]
    proposal_id: str
    summary_of_changes: str
    diffs: List[Dict[str, Any]]
    proposed_version: str
    proposed_content: str
    warnings: List[str]
    approved: bool
    version_id: Optional[str]
    error: Optional[str]
