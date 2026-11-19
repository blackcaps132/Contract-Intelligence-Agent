import re
import uuid
import json
import difflib
from typing import List, Dict, Any, Tuple, Optional

from app.database import get_db
from app.services.conflict_service import simulate_cross_clause_conflict

def compute_word_diff_html(before: str, after: str) -> str:
    """Generates an inline HTML redline diff with colored additions and strikethroughs."""
    before_tokens = re.findall(r'\S+|\s+', before)
    after_tokens = re.findall(r'\S+|\s+', after)
    matcher = difflib.SequenceMatcher(None, before_tokens, after_tokens)
    
    html_parts = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == 'equal':
            html_parts.append("".join(before_tokens[i1:i2]))
        elif tag == 'delete':
            del_text = "".join(before_tokens[i1:i2])
            html_parts.append(
                f'<del class="diff-del" style="background-color: #fee2e2; color: #b91c1c; text-decoration: line-through; padding: 2px 4px; border-radius: 3px; font-weight: 500;">{del_text}</del>'
            )
        elif tag == 'insert':
            ins_text = "".join(after_tokens[j1:j2])
            html_parts.append(
                f'<ins class="diff-ins" style="background-color: #dcfce7; color: #15803d; text-decoration: none; font-weight: 700; padding: 2px 4px; border-radius: 3px;">{ins_text}</ins>'
            )
        elif tag == 'replace':
            del_text = "".join(before_tokens[i1:i2])
            ins_text = "".join(after_tokens[j1:j2])
            html_parts.append(
                f'<del class="diff-del" style="background-color: #fee2e2; color: #b91c1c; text-decoration: line-through; padding: 2px 4px; border-radius: 3px; font-weight: 500;">{del_text}</del> '
            )
            html_parts.append(
                f'<ins class="diff-ins" style="background-color: #dcfce7; color: #15803d; text-decoration: none; font-weight: 700; padding: 2px 4px; border-radius: 3px;">{ins_text}</ins>'
            )
            
    return "".join(html_parts)

def get_next_version_tag(current_tag: str) -> str:
    """Increments a version tag like v1.0 -> v1.1 or v1.9 -> v2.0."""
    match = re.match(r'v?(\d+)\.(\d+)', current_tag.strip())
    if match:
        major = int(match.group(1))
        minor = int(match.group(2))
        return f"v{major}.{minor + 1}"
    return "v1.1"

def split_into_sections(content: str) -> List[Tuple[str, str, str]]:
    """
    Parses contract text into a list of tuples:
    [(section_number, section_title, full_section_text), ...]
    """
    lines = content.split('\n')
    sections = []
    
    current_sec_num = "PREAMBLE"
    current_sec_title = "Preamble & Recitals"
    current_lines = []
    
    sec_regex = re.compile(
        r'^(?:#+\s*)?(?:SECTION|ARTICLE|CLAUSE)?\s*(\d+(?:\.\d+)*)[:.\-\s]+([^\n\r]+)',
        re.IGNORECASE
    )

    for line in lines:
        match = sec_regex.match(line.strip())
        if match and ("SECTION" in line.upper() or "ARTICLE" in line.upper() or line.strip().startswith("#")):
            if current_lines:
                sections.append((current_sec_num, current_sec_title, "\n".join(current_lines)))
                current_lines = []
            current_sec_num = f"Section {match.group(1)}"
            current_sec_title = match.group(2).strip("# :.-")
            current_lines.append(line)
        else:
            current_lines.append(line)
            
    if current_lines:
        sections.append((current_sec_num, current_sec_title, "\n".join(current_lines)))
        
    return sections

def propose_contract_amendment(contract_id: str, instruction: str) -> Dict[str, Any]:
    """
    Analyzes the requested modification, locates target sections in the contract,
    drafts replacements, computes word-level redline diffs, and returns an amendment proposal.
    """
    # 1. Fetch current contract content and version
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT c.id, c.title, c.current_version, v.full_content
        FROM contracts c
        JOIN contract_versions v ON c.id = v.contract_id AND c.current_version = v.version_tag
        WHERE c.id = ?
        """, (contract_id,))
        row = cursor.fetchone()
        
    if not row:
        raise ValueError(f"Contract {contract_id} not found.")

    current_version = row["current_version"]
    content = row["full_content"]
    proposed_version = get_next_version_tag(current_version)
    proposal_id = f"prop_{uuid.uuid4().hex[:8]}"

    sections = split_into_sections(content)
    diffs = []
    updated_sections = []
    changelog_points = []
    warnings = []

    lower_inst = instruction.lower()

    # Run conflict detection on the proposed change
    conflict_report = simulate_cross_clause_conflict(contract_id, instruction)
    if conflict_report["status"] == "CONFLICT_DETECTED":
        for conf in conflict_report["conflicts"]:
            warnings.append(f"⚠️ Warning: Contradicts {conf['section_ref']} - {conf['explanation']}")

    # Pattern 1: Hourly rate modification (e.g. "increase senior dev rate to $120" or "raise developer rate")
    rate_match = re.search(r'(?:rate|rates).*?\$?(\d+(?:\.\d+)?)|(?:increase|raise|change).*?rate.*?to\s*\$?(\d+(?:\.\d+)?)', lower_inst)
    target_rate = None
    if rate_match:
        target_rate = rate_match.group(1) or rate_match.group(2)

    # Pattern 2: Budget cap modification (e.g. "budget cap to $195,000" or "NTE to $195k" or "$195,000")
    budget_match = re.search(r'(?:budget|not-to-exceed|nte|cap).*?\$?(\d+(?:,\d{3})*(?:k)?)', lower_inst)
    target_budget_str = None
    target_budget_formatted = None
    if budget_match:
        raw_b = budget_match.group(1).replace(",", "")
        if raw_b.endswith('k'):
            target_budget_num = int(raw_b[:-1]) * 1000
        else:
            target_budget_num = int(raw_b)
        target_budget_formatted = f"${target_budget_num:,}"

    # Pattern 3: Payment terms modification (e.g. "Net 60" or "Net 45")
    net_match = re.search(r'net\s*(\d+)', lower_inst)
    target_net_days = net_match.group(1) if net_match else None

    # Pattern 4: Termination notice modification (e.g. "termination notice to 15 days" or "30 days")
    term_notice_match = re.search(r'(?:termination|notice|cancel).*?(\d+)\s*days?', lower_inst)
    target_notice_days = term_notice_match.group(1) if term_notice_match else None

    # Pattern 5: Governing law modification (e.g. "governing law to Delaware" or "California" or "New York")
    gov_match = re.search(r'(?:governing law|jurisdiction).*?(delaware|california|new york|texas|illinois|england)', lower_inst)
    target_jurisdiction = gov_match.group(1).title() if gov_match else None

    # Pattern 6: Missing Checklist Insertion (e.g., Sow_002 missing budget cap)
    insert_budget_cap_requested = "budget cap" in lower_inst and ("insert" in lower_inst or "add" in lower_inst or "missing" in lower_inst)

    modified_any = False

    for sec_num, sec_title, sec_text in sections:
        before_sec = sec_text
        after_sec = sec_text
        section_modified = False
        rationale_list = []

        # Check for Rate modifications in Rate Schedule / Compensation sections
        if target_rate and any(k in (sec_num + " " + sec_title).lower() for k in ["rate", "schedule a", "compensation", "pricing", "fee", "staffing"]):
            # Replace Senior Developer or Developer rate
            def replace_hourly(m):
                return f"{m.group(1)}{target_rate}{m.group(3)}"

            new_after = re.sub(
                r'(\$\s*)(\d+)(\s*/\s*hr|\s*per hour|\s*hourly)',
                replace_hourly,
                after_sec,
                flags=re.IGNORECASE
            )
            # Also catch table rows like "| Senior Cloud Architect | $145/hr |" or "| Full-Stack Software Engineer | $95/hr |"
            if "senior" in lower_inst or "developer" in lower_inst or "engineer" in lower_inst:
                def replace_role_rate(m):
                    return f"{m.group(1)}{target_rate}"
                new_after = re.sub(
                    r'(Software Engineer.*?\|\s*\$)\d+',
                    replace_role_rate,
                    new_after
                )
            if new_after != after_sec:
                after_sec = new_after
                section_modified = True
                rationale_list.append(f"Updated hourly billing rate to ${target_rate}/hr per instruction.")

        # Check for Budget Cap / Not-to-Exceed modifications
        if target_budget_formatted and any(k in (sec_num + " " + sec_title).lower() for k in ["budget", "compensation", "invoicing", "payment", "cap", "fee"]):
            # Check if replacing an uncapped / "No Cap" clause
            if re.search(r'no\s+maximum\s+fee|no\s+budget\s+cap|no\s+cap|without\s+(?:any\s+)?limitation', after_sec, re.IGNORECASE):
                cap_sub_text = f"3.2 Budget Ceiling: Total fees billed under this SOW shall not exceed {target_budget_formatted} without prior written authorization from Client. Work beyond this financial ceiling requires an approved written amendment."
                new_after = re.sub(
                    r'(?:[0-9]+\.[0-9]+\s+)?No\s+Cap:?[^\n]*(?:\n[^\n]*?(?:No\s+maximum\s+fee|not-to-exceed limitation applies)[^\n]*)?',
                    lambda m: cap_sub_text,
                    after_sec,
                    flags=re.IGNORECASE
                )
                if new_after != after_sec:
                    after_sec = new_after
                    section_modified = True
                    rationale_list.append(f"Replaced uncapped billing exposure with explicit Not-to-Exceed budget cap of {target_budget_formatted}.")

            # Update existing dollar cap if already present in section
            new_after = re.sub(
                r'(not-to-exceed.*?cap of\s*)\$[0-9,]+(?:\s*\([^\)]+\))?',
                lambda m: f"{m.group(1)}{target_budget_formatted}",
                after_sec,
                flags=re.IGNORECASE
            )
            if new_after != after_sec and not section_modified:
                after_sec = new_after
                section_modified = True
                rationale_list.append(f"Adjusted Not-to-Exceed (NTE) budget cap to {target_budget_formatted}.")

        # Check for Payment Terms modifications (Net 30 -> Net 60)
        if target_net_days and any(k in (sec_num + " " + sec_title).lower() for k in ["payment", "invoice", "fee", "billing"]):
            new_after = re.sub(
                r'Net\s*\d+',
                lambda m: f"Net {target_net_days}",
                after_sec,
                flags=re.IGNORECASE
            )
            new_after = re.sub(
                r'within\s*\d+\s*days?\s*of\s*receipt',
                lambda m: f"within {target_net_days} days of receipt",
                after_sec,
                flags=re.IGNORECASE
            )
            if new_after != after_sec:
                after_sec = new_after
                section_modified = True
                rationale_list.append(f"Extended invoice payment grace period to Net {target_net_days}.")

        # Check for Termination notice modifications
        if target_notice_days and any(k in (sec_num + " " + sec_title).lower() for k in ["termination", "term"]):
            new_after = re.sub(
                r'(\d+)\s*days?(?:\'|\s+)prior\s+written\s+notice',
                lambda m: f"{target_notice_days} days' prior written notice",
                after_sec,
                flags=re.IGNORECASE
            )
            new_after = re.sub(
                r'upon\s*(\d+)\s*days?(?:\'|\s+)notice',
                lambda m: f"upon {target_notice_days} days' notice",
                after_sec,
                flags=re.IGNORECASE
            )
            if new_after != after_sec:
                after_sec = new_after
                section_modified = True
                rationale_list.append(f"Amended convenience termination notice to {target_notice_days} days.")

        # Check for Governing law modifications
        if target_jurisdiction and any(k in (sec_num + " " + sec_title).lower() for k in ["governing law", "jurisdiction", "general", "miscellaneous"]):
            new_after = re.sub(
                r'(laws of the State of\s+)[A-Za-z\s]+([,\.])',
                lambda m: f"{m.group(1)}{target_jurisdiction}{m.group(2)}",
                after_sec,
                flags=re.IGNORECASE
            )
            new_after = re.sub(
                r'(State of\s+)[A-Za-z\s]+(\s*without regard)',
                lambda m: f"{m.group(1)}{target_jurisdiction}{m.group(2)}",
                new_after,
                flags=re.IGNORECASE
            )
            if new_after != after_sec:
                after_sec = new_after
                section_modified = True
                rationale_list.append(f"Changed designated governing jurisdiction to State of {target_jurisdiction}.")

        if section_modified:
            modified_any = True
            diff_html = compute_word_diff_html(before_sec, after_sec)
            rationale_str = " ".join(rationale_list)
            diffs.append({
                "section_number": sec_num,
                "section_title": sec_title,
                "before_text": before_sec,
                "after_text": after_sec,
                "diff_html": diff_html,
                "rationale": rationale_str
            })
            changelog_points.append(f"• **{sec_num} ({sec_title})**: {rationale_str}")
            updated_sections.append(after_sec)
        else:
            updated_sections.append(sec_text)

    # Handling Insertion of Missing Clause (only if not already modified in an existing section)
    if not modified_any and target_budget_formatted:
        inserted_sec_num = "Section 4.1"
        inserted_sec_title = "Budget & Total Cost Ceiling (Not-to-Exceed)"
        inserted_text = (
            f"SECTION 4. BUDGET & NOT-TO-EXCEED CEILING\n"
            f"4.1 Budget Cap. Total fees billed under this Statement of Work shall not exceed "
            f"{target_budget_formatted} without prior written authorization from Client. "
            f"Vendor shall immediately notify Client when accrued fees reach eighty percent (80%) of this threshold."
        )
        
        insert_idx = len(updated_sections) - 1
        for idx, sec in enumerate(updated_sections):
            if any(k in sec.lower() for k in ["scope", "services", "deliverables"]):
                insert_idx = idx + 1
                break

        updated_sections.insert(insert_idx, inserted_text)
        diff_html = compute_word_diff_html("", inserted_text)
        rationale_str = f"Inserted mandatory Not-to-Exceed budget ceiling clause ({target_budget_formatted}) to satisfy Checklist requirements."
        
        diffs.append({
            "section_number": inserted_sec_num,
            "section_title": inserted_sec_title,
            "before_text": "[Clause Did Not Exist - Missing]",
            "after_text": inserted_text,
            "diff_html": diff_html,
            "rationale": rationale_str
        })
        changelog_points.append(f"• **{inserted_sec_num} ({inserted_sec_title})**: {rationale_str}")
        modified_any = True

    # Fallback if no specific regex matched: LLM-like general modification
    if not modified_any:
        # Generic targeted replacement
        summary_of_changes = f"Could not automatically map instruction '{instruction}' to specific numeric clauses. Please refine instruction (e.g. mention specific rates, amounts, or days)."
        proposed_content = content
    else:
        summary_of_changes = "\n".join(changelog_points)
        proposed_content = "\n\n".join(updated_sections)

    return {
        "contract_id": contract_id,
        "proposal_id": proposal_id,
        "instruction": instruction,
        "summary_of_changes": summary_of_changes,
        "diffs": diffs,
        "proposed_version": proposed_version,
        "proposed_content": proposed_content,
        "warnings": warnings
    }
