from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field

class ChecklistItem(BaseModel):
    name: str = Field(..., description="Name of the checklist item (e.g. Explicit Budget Cap)")
    status: str = Field(..., description="'PASSED', 'MISSING', or 'AMBIGUOUS'")
    found_text: str = Field("", description="Exact clause snippet extracted from contract")
    clause_ref: str = Field("", description="Section/Clause number where found (e.g. Section 4.1)")
    details: str = Field(..., description="Explanation of how the clause satisfies or fails the checklist")
    remediation_clause: Optional[str] = Field(None, description="Suggested standard clause to insert if missing")

class RiskFlag(BaseModel):
    severity: str = Field(..., description="'HIGH' or 'MEDIUM'")
    title: str = Field(..., description="Brief summary of risk (e.g. Uncapped Customer Liability)")
    clause_ref: str = Field(..., description="Section where the risk exists")
    snippet: str = Field(..., description="Exact problematic contract text")
    explanation: str = Field(..., description="Why this creates legal or commercial exposure")
    suggested_fallback: str = Field(..., description="Recommended balanced clause replacement")

class ContractMetadata(BaseModel):
    title: str = ""
    counterparty: str = ""
    contract_type: str = ""
    effective_date: str = ""
    expiration_date: str = ""
    total_value: str = ""
    governing_jurisdiction: str = ""

class AnalysisResponse(BaseModel):
    contract_id: str
    title: str
    contract_type: str
    current_version: str
    status: str = "Pending Review"
    checklist_score: str # e.g. "5/6 Passed (83%)"
    checklist_items: List[ChecklistItem]
    risk_flags: List[RiskFlag]
    metadata: ContractMetadata
    executive_summary: str

class ContractListItem(BaseModel):
    id: str
    title: str
    counterparty: str
    contract_type: str
    current_version: str
    status: str = Field("Pending Review", description="Review status: 'Pending Review', 'Needs Changes', or 'Completed'")
    checklist_score: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class ContractDetailResponse(BaseModel):
    id: str
    title: str
    counterparty: str
    contract_type: str
    current_version: str
    status: str = Field("Pending Review", description="Review status: 'Pending Review', 'Needs Changes', or 'Completed'")
    checklist_score: Optional[str] = "Pending Analysis"
    checklist_items: List[ChecklistItem] = []
    risk_flags: List[RiskFlag] = []
    metadata: ContractMetadata = ContractMetadata()
    executive_summary: Optional[str] = None
    content: str
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

# --- Phase 3: Q&A & Conflict Simulator Schemas ---
class QARequest(BaseModel):
    query: str = Field(..., description="User question or proposed contract modification")

class Citation(BaseModel):
    section: str
    snippet: str
    relevance: float

class ConflictItem(BaseModel):
    section_ref: str
    conflicting_text: str
    explanation: str
    severity: str

class ConflictReport(BaseModel):
    status: str # "CONFLICT_DETECTED" or "CLEAN_CHANGE"
    severity: str # "HIGH", "MEDIUM", "NONE"
    proposed_change: str
    conflict_count: int
    conflicts: List[ConflictItem]
    recommendations: List[str]
    analyzed_clauses: List[str]

class QAResponse(BaseModel):
    contract_id: str
    query: str
    query_type: str # "QUESTION" or "PROPOSED_CHANGE"
    answer: str
    citations: List[Citation]
    conflict_report: Optional[ConflictReport] = None

# --- Phase 4: Smart Modifications & Git-Style Versioning Schemas ---

class ClauseDiff(BaseModel):
    section_number: str
    section_title: str
    before_text: str
    after_text: str
    diff_html: str = ""
    rationale: str

class AmendmentProposalRequest(BaseModel):
    instruction: str = Field(..., description="Natural language amendment request (e.g. 'Increase senior dev rate to $120 and NTE budget to $195k')")
    author_name: Optional[str] = "Legal Counsel"

class AmendmentProposalResponse(BaseModel):
    contract_id: str
    proposal_id: str
    instruction: str
    summary_of_changes: str
    diffs: List[ClauseDiff]
    proposed_version: str # e.g. "v1.1"
    proposed_content: str
    warnings: List[str] = []

class CommitRequest(BaseModel):
    proposal_id: Optional[str] = None
    author_name: str = "Legal Counsel"
    commit_message: str
    updated_content: str
    diffs: List[ClauseDiff] = []
    changelog_summary: Optional[str] = ""

class CommitResponse(BaseModel):
    contract_id: str
    version_id: str
    version_tag: str
    author_name: str
    commit_message: str
    changelog_summary: str
    diffs_count: int
    created_at: str

class VersionDiffRecord(BaseModel):
    id: str
    section_number: str
    section_title: str
    before_text: str
    after_text: str
    rationale: str

class VersionHistoryItem(BaseModel):
    version_id: str
    contract_id: str
    version_tag: str
    author_name: str
    commit_message: str
    changelog_summary: str
    created_at: str
    is_current: bool = False
    diffs: List[VersionDiffRecord] = []

class RollbackRequest(BaseModel):
    target_version_id: str
    author_name: Optional[str] = "Legal Counsel"
    reason: Optional[str] = "Rollback to previous approved state"
