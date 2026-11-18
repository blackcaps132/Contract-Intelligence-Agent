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
    status: str
    checklist_score: str
    created_at: str
    updated_at: str

class ContractDetailResponse(BaseModel):
    id: str
    title: str
    counterparty: str
    contract_type: str
    current_version: str
    status: str
    checklist_score: str
    checklist_items: List[ChecklistItem]
    risk_flags: List[RiskFlag]
    metadata: ContractMetadata
    content: str
    created_at: str
    updated_at: str
