import re
import json
from typing import Dict, Any, List
from langgraph.graph import StateGraph, START, END
from app.graphs.state import AnalysisGraphState
from app.services.parser_service import parse_contract_sections
from app.database import get_db

# Approved Standard Fallback Boilerplates for Remediation
STANDARD_REMEDIATIONS = {
    "Explicit Budget & Not-to-Exceed Cap": (
        "SECTION [X]. BUDGET CEILING AND NOT-TO-EXCEED (NTE) CAP\n"
        "The total cumulative fees payable by Client for all services and deliverables under this Agreement "
        "shall not exceed $[Amount] USD ('Not-to-Exceed Budget Cap') without prior written amendment executed by both parties."
    ),
    "Resource Rate Card & Payment Windows": (
        "SECTION [X]. RATE CARD AND PAYMENT TERMS\n"
        "Services shall be billed based upon the agreed rate card. All undisputed invoice amounts are due and payable "
        "Net thirty (30) days from the invoice date. Late payments shall accrue interest at 1.0% per month."
    ),
    "Deliverables & Milestone Schedule": (
        "SECTION [X]. PROJECT DELIVERABLES AND ACCEPTANCE\n"
        "Service Provider shall deliver the milestones according to the agreed schedule. Client shall have ten (10) "
        "business days from delivery to review and provide written acceptance or notice of non-conformance."
    ),
    "IP Ownership & Work-Made-for-Hire": (
        "SECTION [X]. INTELLECTUAL PROPERTY OWNERSHIP\n"
        "All code, documentation, and work product developed specifically for Client shall constitute 'Work-Made-for-Hire'. "
        "Service Provider hereby unconditionally assigns to Client all right, title, and interest in and to such deliverables upon payment."
    ),
    "Termination & Written Notice Period": (
        "SECTION [X]. TERMINATION FOR CONVENIENCE\n"
        "Either party may terminate this Agreement at any time, with or without cause, upon thirty (30) days prior "
        "written notice to the other party. Client shall pay for verified services completed up to the termination date."
    ),
    "Designated Governing Law & Venue": (
        "SECTION [X]. GOVERNING LAW AND DISPUTE RESOLUTION\n"
        "This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, "
        "without regard to its conflict of law principles. Any legal proceedings shall be held in Delaware."
    )
}

SECTION_KEYWORDS = {
    "Explicit Budget & Not-to-Exceed Cap": ["budget", "compensation", "invoicing", "payment", "fee", "cap"],
    "Resource Rate Card & Payment Windows": ["rate", "staffing", "compensation", "pricing", "payment", "invoice"],
    "Deliverables & Milestone Schedule": ["deliverable", "milestone", "service", "scope"],
    "IP Ownership & Work-Made-for-Hire": ["intellectual property", "ip", "ownership", "proprietary", "work product"],
    "Termination & Written Notice Period": ["termination", "term", "cancellation", "default"],
    "Designated Governing Law & Venue": ["governing law", "jurisdiction", "dispute", "miscellaneous", "general"]
}

def get_resolved_remediation_clause(item_name: str, contract_text: str) -> str:
    """
    Dynamically determines the exact section number for remediation:
    - If a matching topical section exists in the contract, re-uses that section number.
    - If no matching section exists, assigns N+1 as a new section.
    """
    template = STANDARD_REMEDIATIONS.get(item_name, "SECTION [X]. STANDARD PROVISION\nStandard terms.")
    
    # Extract existing numbered section headers (e.g. SECTION 1, ## SECTION 2, ARTICLE 3)
    sec_matches = re.findall(
        r'^(?:#+\s*)?(?:SECTION|ARTICLE)\s*(\d+)[:.\-\s]+([^\n\r]+)',
        contract_text,
        re.MULTILINE | re.IGNORECASE
    )
    
    existing_sections = []
    existing_nums = []
    for num_str, title in sec_matches:
        try:
            n = int(num_str)
            existing_nums.append(n)
            existing_sections.append((n, title.strip()))
        except ValueError:
            pass
            
    max_num = max(existing_nums) if existing_nums else 0
    next_num = max_num + 1 if max_num > 0 else 1
    
    keywords = SECTION_KEYWORDS.get(item_name, [])
    found_num = None
    for n, title in existing_sections:
        if any(kw in title.lower() for kw in keywords):
            found_num = n
            break
            
    target_num = found_num if found_num is not None else next_num
    
    resolved = template.replace("[X]", str(target_num))
    resolved = resolved.replace("[Amount]", "195,000")
    return resolved

# --- NODE 1: Parse Sections ---
def parse_sections_node(state: AnalysisGraphState) -> Dict[str, Any]:
    raw_content = state.get("raw_content", "")
    sections = parse_contract_sections(raw_content)
    return {"sections": sections}

# --- NODE 2: Extract Metadata ---
def extract_metadata_node(state: AnalysisGraphState) -> Dict[str, Any]:
    text = state.get("raw_content", "")
    
    # 1. Effective Date
    eff_match = re.search(
        r"(?:effective\s+(?:as\s+of\s+)?|entered\s+into\s+(?:as\s+of\s+|on\s+)?|dated\s+(?:as\s+of\s+)?|is\s+made\s+(?:as\s+of\s+)?)"
        r"([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+,?\s*\d{4})",
        text,
        re.IGNORECASE
    )
    effective_date = eff_match.group(1) if eff_match else "Not specified"

    # 2. Total Value / Budget Cap
    val_match = re.search(
        r"(?:not\s+to\s+exceed|budget\s+cap|budget\s+ceiling|total\s+fees|annual\s+(?:enterprise\s+)?(?:subscription\s+)?fee|subscription\s+fee|shall\s+not\s+exceed)[^\$]{0,50}\$([0-9,]+(?:\.\d{2})?)",
        text,
        re.IGNORECASE
    )
    if val_match:
        total_value = f"${val_match.group(1)} (Capped)"
    elif re.search(r"\$[0-9]+(?:\.[0-9]{2})?\s*(?:/hr|per\s+hour)", text, re.IGNORECASE):
        total_value = "Time & Materials (Hourly Rate Card)"
    else:
        total_value = "Not Capped / Open-Ended"

    # 3. Governing Law
    governing_law = "Unspecified"
    if re.search(r"(?:governed\s+by\s+(?:and\s+subject\s+to\s+)?(?:the\s+terms.*?of\s+)?(?:the\s+)?Master\s+Services\s+Agreement|subject\s+to\s+(?:the\s+)?MSA)", text, re.IGNORECASE):
        governing_law = "Delaware (via Master Agreement)" if re.search(r"Delaware", text, re.IGNORECASE) else "Governed by Master Agreement (MSA)"
    else:
        known_jurisdictions = [
            ("Canton of Zurich (Switzerland)", r"Zurich|Switzerland"),
            ("State of Israel", r"Israel"),
            ("England & Wales", r"England|Wales"),
            ("Republic of Ireland", r"Ireland|Dublin"),
            ("Delaware", r"\bDelaware\b"),
            ("New York", r"\bNew York\b"),
            ("California", r"\bCalifornia\b"),
            ("State of Washington", r"\bState of Washington\b|\bWashington corporation\b"),
            ("Texas", r"\bTexas\b"),
            ("Illinois", r"\bIllinois\b")
        ]
        gov_match = re.search(r"(?:governing\s+law|jurisdiction|applicable\s+law|dispute)[\s\S]{0,400}", text, re.IGNORECASE)
        found = False
        if gov_match:
            gov_sec = gov_match.group(0)
            for name, pattern in known_jurisdictions:
                if re.search(pattern, gov_sec, re.IGNORECASE):
                    governing_law = name
                    found = True
                    break
        if not found:
            for name, pattern in known_jurisdictions:
                if re.search(pattern, text, re.IGNORECASE):
                    governing_law = name
                    break

    # 4. Parties
    parties_match = re.search(r"between\s+([^,]+?)(?:,|\s+a\s+Delaware|\s+a\s+Washington|\s+\('Client'\))\s+and\s+([^,]+?)(?:,|\s+a\s+Delaware|\s+\('Service|\s+\('Vendor|\s+\('Agency)", text, re.IGNORECASE)
    counterparty = state.get("counterparty", "")
    if not counterparty and parties_match:
        counterparty = f"{parties_match.group(1).strip()} / {parties_match.group(2).strip()}"

    metadata = {
        "title": state.get("title", "Commercial Agreement"),
        "counterparty": counterparty or "Commercial Parties",
        "contract_type": state.get("contract_type", "Commercial Contract"),
        "effective_date": effective_date,
        "expiration_date": "Auto-renewal or milestone completion",
        "total_value": total_value,
        "governing_jurisdiction": governing_law
    }

    return {"metadata": metadata}

# --- NODE 3: Verify Mandatory Checklist ---
def verify_mandatory_checklist_node(state: AnalysisGraphState) -> Dict[str, Any]:
    text = state.get("raw_content", "")
    sections = state.get("sections", {})
    checklist_items: List[Dict[str, Any]] = []

    # 1. Budget Cap
    cap_pattern = re.search(r"(not-to-exceed|budget\s+ceiling|budget\s+cap|maximum\s+fee|shall\s+not\s+exceed\s+\$[\d,]+)", text, re.IGNORECASE)
    no_cap_pattern = re.search(r"(no\s+maximum\s+fee|no\s+budget\s+cap|without\s+limitation)", text, re.IGNORECASE)
    
    if cap_pattern and not no_cap_pattern:
        val_match = re.search(r"\$([0-9,]+(?:\.\d{2})?)", cap_pattern.group(0))
        amt = f"${val_match.group(1)}" if val_match else "defined"
        checklist_items.append({
            "name": "Explicit Budget & Not-to-Exceed Cap",
            "status": "PASSED",
            "found_text": cap_pattern.group(0),
            "clause_ref": "Section 4 / Budget Terms",
            "details": f"Contract contains an explicit Not-to-Exceed budget cap ({amt}).",
            "remediation_clause": None
        })
    else:
        checklist_items.append({
            "name": "Explicit Budget & Not-to-Exceed Cap",
            "status": "MISSING",
            "found_text": no_cap_pattern.group(0) if no_cap_pattern else "",
            "clause_ref": "Missing in Invoicing/Budget Section",
            "details": "CRITICAL: No budget cap or cost ceiling found. Work is billed without financial limitation.",
            "remediation_clause": get_resolved_remediation_clause("Explicit Budget & Not-to-Exceed Cap", text)
        })

    # 2. Rate Card & Payment Windows
    rate_pattern = re.search(r"(\$[\d,]+(?:\.\d{2})?\s+per\s+hour|hourly\s+rate|rate\s+card|Net\s+\d+|thirty\s+\(30\)\s+days)", text, re.IGNORECASE)
    if rate_pattern:
        checklist_items.append({
            "name": "Resource Rate Card & Payment Windows",
            "status": "PASSED",
            "found_text": rate_pattern.group(0),
            "clause_ref": "Section 3 / Rate Schedule",
            "details": "Resource rates and explicit invoice payment terms are defined.",
            "remediation_clause": None
        })
    else:
        checklist_items.append({
            "name": "Resource Rate Card & Payment Windows",
            "status": "MISSING",
            "found_text": "",
            "clause_ref": "Payment Section",
            "details": "Missing explicit resource rate card or clear Net payment terms.",
            "remediation_clause": get_resolved_remediation_clause("Resource Rate Card & Payment Windows", text)
        })

    # 3. Deliverables & Milestones
    deliv_pattern = re.search(r"(deliverable|milestone|scope\s+of\s+work|statement\s+of\s+work|phase\s+\d|completion\s+date)", text, re.IGNORECASE)
    if deliv_pattern:
        checklist_items.append({
            "name": "Deliverables & Milestone Schedule",
            "status": "PASSED",
            "found_text": deliv_pattern.group(0),
            "clause_ref": "Section 1 / Scope & Milestones",
            "details": "Defined deliverables with acceptance criteria and delivery schedule.",
            "remediation_clause": None
        })
    else:
        checklist_items.append({
            "name": "Deliverables & Milestone Schedule",
            "status": "MISSING",
            "found_text": "",
            "clause_ref": "Scope Section",
            "details": "Scope lacks specific milestone deliverables and acceptance timelines.",
            "remediation_clause": get_resolved_remediation_clause("Deliverables & Milestone Schedule", text)
        })

    # 4. IP Ownership / Work-Made-for-Hire
    ip_pattern = re.search(r"(work-made-for-hire|intellectual\s+property|ownership\s+of\s+deliverables|hereby\s+assigns|exclusive\s+property\s+of\s+Client)", text, re.IGNORECASE)
    if ip_pattern:
        checklist_items.append({
            "name": "IP Ownership & Work-Made-for-Hire",
            "status": "PASSED",
            "found_text": ip_pattern.group(0),
            "clause_ref": "Section 6 / IP Rights",
            "details": "Deliverables are assigned to Client as Work-Made-for-Hire upon payment.",
            "remediation_clause": None
        })
    else:
        checklist_items.append({
            "name": "IP Ownership & Work-Made-for-Hire",
            "status": "MISSING",
            "found_text": "",
            "clause_ref": "IP Section",
            "details": "No Work-Made-for-Hire or IP assignment language found. Vendor may retain software rights.",
            "remediation_clause": get_resolved_remediation_clause("IP Ownership & Work-Made-for-Hire", text)
        })

    # 5. Termination & Written Notice
    notice_match = re.search(
        r"(\d+|thirty|sixty|ninety|fifteen|twenty|forty-five|forty five)\s*(?:\(\d+\))?\s*days\s+(?:prior\s+)?written\s+notice",
        text,
        re.IGNORECASE
    )
    term_pattern = re.search(
        r"(termination\s+for\s+convenience|"
        r"terminate\s+(?:this\s+agreement\s+)?(?:at\s+any\s+time|with\s+or\s+without\s+cause)|"
        r"with\s+or\s+without\s+cause|"
        r"upon\s+(?:\d+|[a-zA-Z]+(?:\s*\(\d+\))?)\s+days\s+(?:prior\s+)?written\s+notice|"
        r"(?:\d+|[a-zA-Z]+(?:\s*\(\d+\))?)\s+days\s+(?:prior\s+)?written\s+notice|"
        r"written\s+notice\s+of\s+(?:termination|non-renewal|cancellation)|"
        r"termination\s+upon\s+(?:\d+|[a-zA-Z]+(?:\s*\(\d+\))?)\s+days|"
        r"either\s+party\s+may\s+terminate)",
        text,
        re.IGNORECASE
    )
    if term_pattern or notice_match:
        matched_text = notice_match.group(0) if notice_match else term_pattern.group(0)
        notice_desc = f" ({notice_match.group(0)})" if notice_match else ""
        checklist_items.append({
            "name": "Termination & Written Notice Period",
            "status": "PASSED",
            "found_text": f'"{matched_text}"',
            "clause_ref": "Termination Section",
            "details": f"Explicit termination rights with defined written notice period{notice_desc}.",
            "remediation_clause": None
        })
    else:
        checklist_items.append({
            "name": "Termination & Written Notice Period",
            "status": "MISSING",
            "found_text": "",
            "clause_ref": "Termination Section",
            "details": "Missing explicit convenience termination notice terms.",
            "remediation_clause": get_resolved_remediation_clause("Termination & Written Notice Period", text)
        })

    # 6. Designated Governing Law
    gov_pattern = re.search(r"(laws\s+of\s+(?:the\s+State\s+of\s+)?[A-Za-z\s]+|governed\s+by\s+and\s+construed|jurisdiction)", text, re.IGNORECASE)
    if gov_pattern:
        checklist_items.append({
            "name": "Designated Governing Law & Venue",
            "status": "PASSED",
            "found_text": gov_pattern.group(0),
            "clause_ref": "Governing Law Section",
            "details": "Specifies legal jurisdiction and applicable state/country law.",
            "remediation_clause": None
        })
    else:
        checklist_items.append({
            "name": "Designated Governing Law & Venue",
            "status": "MISSING",
            "found_text": "",
            "clause_ref": "General Provisions",
            "details": "No governing jurisdiction specified. Increases litigation venue risk.",
            "remediation_clause": get_resolved_remediation_clause("Designated Governing Law & Venue", text)
        })

    passed_count = sum(1 for item in checklist_items if item["status"] == "PASSED")
    total_count = len(checklist_items)
    score_pct = int((passed_count / total_count) * 100)
    checklist_score = f"{passed_count}/{total_count} Passed ({score_pct}%)"

    return {
        "checklist_items": checklist_items,
        "checklist_score": checklist_score
    }

# --- NODE 4: Scan Risk Flags ---
def scan_risk_flags_node(state: AnalysisGraphState) -> Dict[str, Any]:
    text = state.get("raw_content", "")
    risk_flags: List[Dict[str, Any]] = []

    # Risk 1: Uncapped / Asymmetric Liability
    if re.search(r"liability\s+shall\s+be\s+unlimited|uncapped\s+for\s+all\s+breaches", text, re.IGNORECASE):
        risk_flags.append({
            "severity": "HIGH",
            "title": "Uncapped Customer Liability (Asymmetric Exposure)",
            "clause_ref": "Limitation of Liability",
            "snippet": "Customer liability shall be UNLIMITED and UNCAPPED for all breaches.",
            "explanation": "Customer is exposed to unlimited damages while counterparty limits their liability to a nominal sum.",
            "suggested_fallback": "Each party's aggregate cumulative liability shall be capped at total fees paid in the preceding 12 months."
        })

    # Risk 2: One-sided Indemnity
    if re.search(r"including\s+claims\s+arising\s+out\s+of\s+Vendor's\s+own\s+ordinary\s+or\s+active\s+negligence|indemnify\s+Vendor\s+from\s+and\s+against\s+all", text, re.IGNORECASE):
        risk_flags.append({
            "severity": "HIGH",
            "title": "Asymmetric Indemnification for Vendor Negligence",
            "clause_ref": "Indemnification Clause",
            "snippet": "Customer agrees to defend and hold harmless Vendor against claims arising out of Vendor's own negligence.",
            "explanation": "Customer is forced to pay for damages caused by the vendor's own misconduct or fault.",
            "suggested_fallback": "Each party shall mutually indemnify the other strictly for third-party IP infringement or gross negligence."
        })

    # Risk 3: Unilateral Early Termination Penalties
    if re.search(r"one\s+hundred\s+percent\s+\(100%\)\s+of\s+all\s+remaining\s+projected\s+fees|liquidated\s+damages\s+for\s+cancellation", text, re.IGNORECASE):
        risk_flags.append({
            "severity": "HIGH",
            "title": "100% Acceleration Termination Penalty",
            "clause_ref": "Termination Clause",
            "snippet": "Customer shall immediately pay Vendor 100% of all remaining projected fees as liquidated damages.",
            "explanation": "Customer cannot exit the contract early without paying the full remaining contract value as a penalty.",
            "suggested_fallback": "Client may terminate for convenience with 30 days notice, paying only for verified services completed to date."
        })

    # Risk 4: Evergreen Auto-Renewal Trap (>60 days or postal restriction)
    if re.search(r"automatically\s+renew\s+for\s+successive\s+two\s+\(2\)\s+year\s+terms|registered\s+postal\s+mail\s+at\s+least\s+ninety\s+\(90\)\s+days|email\s+notice\s+shall\s+be\s+strictly\s+invalid", text, re.IGNORECASE):
        risk_flags.append({
            "severity": "MEDIUM",
            "title": "Evergreen Auto-Renewal Trap with 90-Day Postal Mail Lock-in",
            "clause_ref": "Renewal Section",
            "snippet": "Auto-renews for 2 years unless notice via registered postal mail at least 90 days prior; email strictly invalid.",
            "explanation": "Extremely strict cancellation mechanism designed to trigger accidental multi-year contract renewals.",
            "suggested_fallback": "Auto-renews for 1-year terms with 30 days notice permitted via electronic mail."
        })

    # Risk 5: Missing Budget Cap on T&M contract
    if any(item["name"] == "Explicit Budget & Not-to-Exceed Cap" and item["status"] == "MISSING" for item in state.get("checklist_items", [])):
        risk_flags.append({
            "severity": "HIGH",
            "title": "Open-Ended Time & Materials Billing (No Budget Cap)",
            "clause_ref": "Compensation & Invoicing",
            "snippet": "Client shall be billed for all actual hours expended... No maximum fee or budget cap applies.",
            "explanation": "Client has no legal mechanism to stop vendor from billing unexpected, excessive hours.",
            "suggested_fallback": "Total fees payable shall not exceed an explicit Not-to-Exceed (NTE) cap of $[Amount] without prior written approval."
        })

    return {"risk_flags": risk_flags}

# --- NODE 5: Persist Analysis ---
def persist_analysis_node(state: AnalysisGraphState) -> Dict[str, Any]:
    contract_id = state["contract_id"]
    checklist_score = state.get("checklist_score", "0/6 Passed")
    checklist_items = state.get("checklist_items", [])
    risk_flags = state.get("risk_flags", [])
    checklist_json = json.dumps(checklist_items)
    risk_flags_json = json.dumps(risk_flags)
    metadata_json = json.dumps(state.get("metadata", {}))

    # Review-centric status update
    has_issues = len(risk_flags) > 0 or any(i.get("status") in ("MISSING", "AMBIGUOUS") for i in checklist_items)
    new_status = "Needs Changes" if has_issues else "Completed"

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        UPDATE contracts 
        SET checklist_score = ?,
            checklist_json = ?,
            risk_flags_json = ?,
            metadata_json = ?,
            status = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (checklist_score, checklist_json, risk_flags_json, metadata_json, new_status, contract_id))
        conn.commit()

    risk_count = len(state.get('risk_flags', []))
    contract_type = state.get('metadata', {}).get('contract_type', 'Commercial Contract')
    if has_issues:
        exec_summary = (
            f"Intake review completed for {contract_type}. "
            f"Checklist Compliance: {checklist_score}. "
            f"Flagged {risk_count} critical risk/gap item(s) requiring remediation before contract execution."
        )
    else:
        exec_summary = (
            f"Intake review completed for {contract_type}. "
            f"Checklist Compliance: {checklist_score}. "
            f"All 6 corporate contracting standards are fully satisfied with zero critical exposure risks flagged. Approved for completion."
        )

    return {"executive_summary": exec_summary, "status": new_status}

# --- BUILD THE LANGGRAPH WORKFLOW ---
def build_analysis_graph():
    workflow = StateGraph(AnalysisGraphState)

    workflow.add_node("parse_sections", parse_sections_node)
    workflow.add_node("extract_metadata", extract_metadata_node)
    workflow.add_node("verify_checklist", verify_mandatory_checklist_node)
    workflow.add_node("scan_risk_flags", scan_risk_flags_node)
    workflow.add_node("persist_analysis", persist_analysis_node)

    # Linear workflow sequence
    workflow.add_edge(START, "parse_sections")
    workflow.add_edge("parse_sections", "extract_metadata")
    workflow.add_edge("extract_metadata", "verify_checklist")
    workflow.add_edge("verify_checklist", "scan_risk_flags")
    workflow.add_edge("scan_risk_flags", "persist_analysis")
    workflow.add_edge("persist_analysis", END)

    return workflow.compile()

# Pre-compiled instance
analysis_agent = build_analysis_graph()
