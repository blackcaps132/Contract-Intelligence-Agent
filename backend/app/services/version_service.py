import uuid
import json
from typing import List, Dict, Any, Optional
from datetime import datetime

from app.database import get_db
from app.services.amendment_service import get_next_version_tag, compute_word_diff_html
from app.services.vector_service import index_contract

def commit_contract_version(
    contract_id: str,
    author_name: str,
    commit_message: str,
    updated_content: str,
    changelog_summary: str = "",
    diffs: List[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Creates a new Git-style version commit:
    - Increments version tag (e.g. v1.0 -> v1.1).
    - Persists full snapshot in contract_versions.
    - Persists granular clause diffs in version_diffs.
    - Updates contracts master pointer.
    - Reindexes vector DB chunks for accurate RAG.
    """
    diffs = diffs or []

    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Fetch current contract details
        cursor.execute("SELECT id, title, current_version FROM contracts WHERE id = ?", (contract_id,))
        contract = cursor.fetchone()
        if not contract:
            raise ValueError(f"Contract {contract_id} not found.")

        current_tag = contract["current_version"]
        new_tag = get_next_version_tag(current_tag)
        version_id = f"ver_{contract_id[:8]}_{new_tag.replace('.', '_')}_{uuid.uuid4().hex[:4]}"
        now_iso = datetime.utcnow().isoformat()

        # 2. Insert into contract_versions
        cursor.execute("""
        INSERT INTO contract_versions (
            version_id, contract_id, version_tag, author_name, commit_message, full_content, changelog_summary, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            version_id,
            contract_id,
            new_tag,
            author_name or "Legal Counsel",
            commit_message or f"Amend contract to {new_tag}",
            updated_content,
            changelog_summary,
            now_iso
        ))

        # 3. Insert individual clause diffs
        for diff in diffs:
            diff_id = f"diff_{uuid.uuid4().hex[:8]}"
            cursor.execute("""
            INSERT INTO version_diffs (
                id, version_id, section_number, section_title, before_text, after_text, rationale
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (
                diff_id,
                version_id,
                diff.get("section_number", "Section N/A"),
                diff.get("section_title", "General"),
                diff.get("before_text", ""),
                diff.get("after_text", ""),
                diff.get("rationale", "")
            ))

        # 4. Update contracts master table
        cursor.execute("""
        UPDATE contracts
        SET current_version = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """, (new_tag, contract_id))

        conn.commit()

    # 5. Reindex newly committed version in ChromaDB
    try:
        index_contract(contract_id, contract["title"], updated_content)
    except Exception as e:
        print(f"Warning: ChromaDB reindex failed for {contract_id}: {e}")

    return {
        "contract_id": contract_id,
        "version_id": version_id,
        "version_tag": new_tag,
        "author_name": author_name or "Legal Counsel",
        "commit_message": commit_message,
        "changelog_summary": changelog_summary,
        "diffs_count": len(diffs),
        "created_at": now_iso
    }

def get_contract_version_history(contract_id: str) -> List[Dict[str, Any]]:
    """
    Returns the complete chronological Git-style commit history tree for a contract,
    including author, commit message, changelog summary, and clause-level diffs.
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Get active version tag
        cursor.execute("SELECT current_version FROM contracts WHERE id = ?", (contract_id,))
        contract = cursor.fetchone()
        if not contract:
            raise ValueError(f"Contract {contract_id} not found.")
        current_version_tag = contract["current_version"]

        # Get all versions
        cursor.execute("""
        SELECT version_id, contract_id, version_tag, author_name, commit_message, changelog_summary, created_at
        FROM contract_versions
        WHERE contract_id = ?
        ORDER BY created_at DESC, version_tag DESC
        """, (contract_id,))
        version_rows = cursor.fetchall()

        history = []
        for v in version_rows:
            v_dict = dict(v)
            v_dict["is_current"] = (v["version_tag"] == current_version_tag)
            
            # Fetch diffs for this version
            cursor.execute("""
            SELECT id, section_number, section_title, before_text, after_text, rationale
            FROM version_diffs
            WHERE version_id = ?
            """, (v["version_id"],))
            diff_rows = cursor.fetchall()
            v_dict["diffs"] = [dict(d) for d in diff_rows]
            
            history.append(v_dict)

        return history

def rollback_contract_version(
    contract_id: str,
    target_version_id: str,
    author_name: str = "Legal Counsel",
    reason: str = "Rollback to previous approved state"
) -> Dict[str, Any]:
    """
    Executes a Git-style revert/rollback:
    - Retrieves the exact content of target_version_id.
    - Creates a new commit tag (e.g. v1.2) whose snapshot matches the target.
    - Preserves immutable audit history (never mutates or deletes prior history).
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Fetch target version
        cursor.execute("""
        SELECT version_id, version_tag, full_content
        FROM contract_versions
        WHERE version_id = ? AND contract_id = ?
        """, (target_version_id, contract_id))
        target_version = cursor.fetchone()
        
        if not target_version:
            raise ValueError(f"Version {target_version_id} not found for contract {contract_id}.")

        # Fetch current active version for diff recording
        cursor.execute("""
        SELECT c.current_version, v.full_content
        FROM contracts c
        JOIN contract_versions v ON c.id = v.contract_id AND c.current_version = v.version_tag
        WHERE c.id = ?
        """, (contract_id,))
        active_version = cursor.fetchone()

    target_tag = target_version["version_tag"]
    target_content = target_version["full_content"]
    current_content = active_version["full_content"] if active_version else ""

    commit_msg = f"Rollback to {target_tag}: {reason}"
    changelog = f"Reverted contract text to historical state of version {target_tag}."

    diffs = [{
        "section_number": "ALL SECTIONS",
        "section_title": f"Reversion to {target_tag}",
        "before_text": "Active Version Content",
        "after_text": f"Restored Content from {target_tag}",
        "rationale": f"Authorized rollback executed by {author_name}. Reason: {reason}"
    }]

    return commit_contract_version(
        contract_id=contract_id,
        author_name=author_name,
        commit_message=commit_msg,
        updated_content=target_content,
        changelog_summary=changelog,
        diffs=diffs
    )
