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
    error: Optional[str]
