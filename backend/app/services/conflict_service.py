import re
from typing import Dict, Any, List
from app.services.vector_service import query_contract_clauses
from app.config import GEMINI_API_KEY, DEFAULT_MODEL
from app.services.llm_service import generate_conflict_simulation

def simulate_cross_clause_conflict(contract_id: str, proposed_change: str) -> Dict[str, Any]:
    """
    Simulates a contemplated contract change against the full document.
    Detects cross-clause contradictions, financial cap breaches, and schedule misalignments.
    Uses Gemini LLM for deep reasoning, falling back to deterministic heuristics.
    """
    # 1. Retrieve all related clauses from ChromaDB
    relevant_chunks = query_contract_clauses(contract_id, proposed_change, top_k=5)
    
    # 2. Try Gemini LLM first if available
    if GEMINI_API_KEY and relevant_chunks:
        try:
            llm_report = generate_conflict_simulation(proposed_change, relevant_chunks, contract_title=contract_id)
            if llm_report and "status" in llm_report:
                return llm_report
        except Exception as e:
            # Fall back to deterministic rules on exception
            pass

    combined_context = "\n\n".join([f"[{c['section_title']}]: {c['text']}" for c in relevant_chunks])
    
    conflicts = []
    recommendations = []
    severity = "NONE"

    change_lower = proposed_change.lower()

    # --- RULE SET 1: Payment Terms & Net Days Changes ---
    if re.search(r"net\s*60|net\s*90|extend\s+payment|change\s+payment\s+to\s+60|payment\s+terms", change_lower):
        # Check for prompt payment discount conflict
        for chunk in relevant_chunks:
            text = chunk["text"]
            if re.search(r"prompt\s+payment\s+discount|discount.*15\s+days|2(?:\.0)?%\s+.*15\s+days", text, re.IGNORECASE):
                conflicts.append({
                    "section_ref": chunk["section_title"],
                    "conflicting_text": "Client entitled to deduct 2% prompt payment discount if paid within 15 days.",
                    "explanation": "Extending payment terms to Net 60/90 diminishes the commercial incentive of the 15-day prompt payment discount and creates ambiguity regarding invoice reconciliation.",
                    "severity": "MEDIUM"
                })
                recommendations.append("Update Section 5.3 to explicitly clarify whether the 15-day discount window remains active or is replaced.")

            if re.search(r"overdue\s+beyond\s+thirty\s+\(30\)\s+days|interest\s+at.*(?:1\.5%|month)|day\s*31", text, re.IGNORECASE):
                conflicts.append({
                    "section_ref": chunk["section_title"],
                    "conflicting_text": "Undisputed amounts overdue beyond thirty (30) days shall accrue interest at 1.5% per month.",
                    "explanation": "CRITICAL CONFLICT: Under Net 60 terms, invoices are not legally due until day 60, but this clause triggers late interest on day 31! Paying on day 45 under Net 60 would improperly trigger penalty interest.",
                    "severity": "HIGH"
                })
                recommendations.append("Must revise the late interest clause to state: 'overdue beyond sixty (60) days' to prevent premature interest accrual.")
                severity = "HIGH"

    # --- RULE SET 2: Rate Card Hikes vs Not-to-Exceed (NTE) Budget Cap ---
    if re.search(r"increase\s+rate|higher\s+rate|\$\d+\s*(?:per\s+hour|/hr)|raise\s+dev|raise\s+rate", change_lower):
        for chunk in relevant_chunks:
            text = chunk["text"]
            cap_match = re.search(r"(?:not-to-exceed|budget\s+ceiling|shall\s+not\s+exceed)[^\$]{0,50}\$([0-9,]+)", text, re.IGNORECASE)
            if cap_match:
                cap_val = f"${cap_match.group(1)}"
                conflicts.append({
                    "section_ref": chunk["section_title"],
                    "conflicting_text": f"Total cumulative fees payable by Client shall not exceed {cap_val} USD.",
                    "explanation": f"FINANCIAL CAP BREACH RISK: Increasing resource hourly rates without raising the {cap_val} Budget Cap will exhaust project funding 25-30% faster than planned, forcing project work to halt prematurely.",
                    "severity": "HIGH"
                })
                recommendations.append(f"Execute a simultaneous amendment to the Not-to-Exceed Budget Cap (Section 4.1) proportional to the rate increase.")
                severity = "HIGH"

    # --- RULE SET 3: Termination Notice Window Reductions ---
    if re.search(r"terminate|reduce\s+notice|immediate\s+termination|15\s+days\s+notice|cancel", change_lower):
        for chunk in relevant_chunks:
            text = chunk["text"]
            if re.search(r"thirty\s+\(30\)\s+days\s+prior\s+written\s+notice|sixty\s+\(60\)\s+days|ninety\s+\(90\)\s+days", text, re.IGNORECASE):
                conflicts.append({
                    "section_ref": chunk["section_title"],
                    "conflicting_text": text[:180] + "...",
                    "explanation": "Reducing notice windows conflicts with existing milestone transition covenants, handover periods, and non-renewal notice requirements.",
                    "severity": "MEDIUM"
                })
                recommendations.append("Verify that deliverable handover and transition obligations can be completed within the shortened notice window.")
                if severity != "HIGH":
                    severity = "MEDIUM"

    # --- RULE SET 4: Liability Cap Modifications ---
    if re.search(r"liability|unlimited|cap|damages", change_lower):
        for chunk in relevant_chunks:
            text = chunk["text"]
            if re.search(r"indemnif|consequential\s+damages|gross\s+negligence", text, re.IGNORECASE):
                conflicts.append({
                    "section_ref": chunk["section_title"],
                    "conflicting_text": text[:180] + "...",
                    "explanation": "Modifying liability caps directly alters exposure under the mutual indemnification and confidentiality carve-outs.",
                    "severity": "HIGH"
                })
                recommendations.append("Ensure any liability cap change explicitly references whether it caps IP indemnification and data breach liabilities.")
                severity = "HIGH"

    status = "CONFLICT_DETECTED" if conflicts else "CLEAN_CHANGE"
    
    if not conflicts:
        recommendations.append("No direct cross-clause contradictions detected in the current agreement for this contemplated change.")

    return {
        "status": status,
        "severity": severity,
        "proposed_change": proposed_change,
        "conflict_count": len(conflicts),
        "conflicts": conflicts,
        "recommendations": recommendations,
        "analyzed_clauses": [c["section_title"] for c in relevant_chunks]
    }
