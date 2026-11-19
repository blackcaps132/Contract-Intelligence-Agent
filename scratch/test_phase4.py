import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BASE_DIR))

from app.database import get_db
from app.graphs.amendment_graph import amendment_agent
from app.graphs.analysis_graph import analysis_agent
from app.services.amendment_service import propose_contract_amendment
from app.services.version_service import (
    commit_contract_version,
    get_contract_version_history,
    rollback_contract_version
)
from app.services.export_service import generate_contract_docx

def run_tests():
    print("=" * 70)
    print("STARTING PHASE 4: SMART MODIFICATIONS & GIT-STYLE VERSIONING TESTS")
    print("=" * 70)

    # -------------------------------------------------------------
    # Test 1: Propose Amendment on sow_001_cloud_migration
    # -------------------------------------------------------------
    print("\n--- Test 1: Propose Amendment on sow_001_cloud_migration ---")
    contract_id = "sow_001_cloud_migration"
    instruction = "Increase developer rate to $120 and budget cap to $195,000"
    
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT current_version FROM contracts WHERE id = ?", (contract_id,))
        baseline_version = cursor.fetchone()["current_version"]

    proposal = propose_contract_amendment(contract_id, instruction)
    print(f"Proposal ID: {proposal['proposal_id']}")
    print(f"Current Baseline: {baseline_version} -> Proposed Version: {proposal['proposed_version']}")
    print(f"Summary of Changes:\n{proposal['summary_of_changes']}")
    print(f"Diffs count: {len(proposal['diffs'])}")
    for d in proposal['diffs']:
        print(f"  * {d['section_number']}: {d['rationale']}")
        print(f"    Diff HTML: {d['diff_html'][:100]}...")
    
    assert len(proposal['diffs']) >= 1, "Expected at least 1 clause diff"
    print(">>> Test 1 Passed!")

    # -------------------------------------------------------------
    # Test 2: Commit Version
    # -------------------------------------------------------------
    print("\n--- Test 2: Commit Version ---")
    commit_res = commit_contract_version(
        contract_id=contract_id,
        author_name="Ayush Jaiswal (Legal Counsel)",
        commit_message="Amend Section 3.1 & 4.1: Rate increase to $120 and NTE budget cap increase to $195,000",
        updated_content=proposal['proposed_content'],
        changelog_summary=proposal['summary_of_changes'],
        diffs=proposal['diffs']
    )
    committed_tag = commit_res['version_tag']
    print(f"Commit Version Tag: {committed_tag}")
    print(f"Version ID: {commit_res['version_id']}")
    print(f"Author: {commit_res['author_name']}")
    print(f"Diffs Recorded: {commit_res['diffs_count']}")

    assert commit_res['version_tag'] == proposal['proposed_version']
    assert commit_res['diffs_count'] == len(proposal['diffs'])
    print(">>> Test 2 Passed!")

    # -------------------------------------------------------------
    # Test 3: Version History Log & Commit Tree
    # -------------------------------------------------------------
    print("\n--- Test 3: Retrieve Version History ---")
    history = get_contract_version_history(contract_id)
    print(f"Total versions in commit tree: {len(history)}")
    for h in history:
        status_marker = "[CURRENT]" if h['is_current'] else "[HISTORICAL]"
        print(f"  {status_marker} Tag: {h['version_tag']} | ID: {h['version_id']} | Author: {h['author_name']} | Diffs: {len(h['diffs'])}")
        print(f"    Message: {h['commit_message']}")

    assert len(history) >= 2, "Expected multiple commits in history"
    assert history[0]['version_tag'] == committed_tag
    assert history[0]['is_current'] is True
    print(">>> Test 3 Passed!")

    # -------------------------------------------------------------
    # Test 4: Word (.docx) Export Generation
    # -------------------------------------------------------------
    print("\n--- Test 4: Generate Word (.docx) Export ---")
    docx_stream = generate_contract_docx(contract_id, committed_tag)
    raw_bytes = docx_stream.getvalue()
    print(f"Generated DOCX size: {len(raw_bytes)} bytes")
    # Verify ZIP/DOCX header signature (PK\x03\x04)
    assert raw_bytes[:4] == b'PK\x03\x04', "Generated file is not a valid docx OpenXML archive!"
    
    # Save a test docx to check
    test_out = BASE_DIR.parent / "scratch" / "test_export_v1.1.docx"
    with open(test_out, "wb") as f:
        f.write(raw_bytes)
    print(f"Exported test file saved to: {test_out}")
    print(">>> Test 4 Passed!")

    # -------------------------------------------------------------
    # Test 5: Rollback to v1.0
    # -------------------------------------------------------------
    print("\n--- Test 5: Rollback to v1.0 ---")
    # Find v1.0 version_id
    v1_id = None
    for h in history:
        if h['version_tag'] == 'v1.0':
            v1_id = h['version_id']
            break

    assert v1_id is not None, "Could not find v1.0 ID"
    rollback_res = rollback_contract_version(
        contract_id=contract_id,
        target_version_id=v1_id,
        author_name="Ayush Jaiswal (Legal Counsel)",
        reason="Client rejected rate adjustment; reverting to baseline terms"
    )
    print(f"Rollback Commit Tag: {rollback_res['version_tag']}")
    print(f"Message: {rollback_res['commit_message']}")
    
    # Verify current history
    history_after = get_contract_version_history(contract_id)
    print(f"New commit count: {len(history_after)}")
    assert history_after[0]['version_tag'] == rollback_res['version_tag']
    assert history_after[0]['is_current'] is True
    print(">>> Test 5 Passed!")

    # -------------------------------------------------------------
    # Test 6: Remediate Missing Budget Cap on sow_002_marketing_growth
    # -------------------------------------------------------------
    print("\n--- Test 6: Remediate sow_002_marketing_growth by Inserting Missing Budget Cap ---")
    # Check original score of sow_002_marketing_growth
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT checklist_score FROM contracts WHERE id = 'sow_002_marketing_growth'")
        old_score = cursor.fetchone()["checklist_score"]
    print(f"sow_002 original checklist score: {old_score}")

    # Propose inserting missing budget cap
    inst_remediate = "Add explicit budget cap of $150,000"
    prop_remediate = propose_contract_amendment("sow_002_marketing_growth", inst_remediate)
    print(f"sow_002 Remediation Proposal Version: {prop_remediate['proposed_version']}")
    print(f"Summary: {prop_remediate['summary_of_changes']}")
    
    # Commit v1.1 on sow_002_marketing_growth
    commit_contract_version(
        contract_id="sow_002_marketing_growth",
        author_name="Legal Operations",
        commit_message="Insert Section 4.1 Mandatory Not-to-Exceed Budget Ceiling ($150,000)",
        updated_content=prop_remediate['proposed_content'],
        changelog_summary=prop_remediate['summary_of_changes'],
        diffs=prop_remediate['diffs']
    )

    # Re-run analysis on sow_002_marketing_growth v1.1
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT c.*, v.full_content
        FROM contracts c
        JOIN contract_versions v ON c.id = v.contract_id AND c.current_version = v.version_tag
        WHERE c.id = 'sow_002_marketing_growth'
        """)
        row_sow2 = cursor.fetchone()

    analysis_res = analysis_agent.invoke({
        "contract_id": "sow_002_marketing_growth",
        "raw_content": row_sow2["full_content"],
        "file_type": "text",
        "title": row_sow2["title"],
        "counterparty": row_sow2["counterparty"],
        "contract_type": row_sow2["contract_type"],
        "sections": {},
        "metadata": {},
        "checklist_items": [],
        "checklist_score": "",
        "risk_flags": [],
        "executive_summary": "",
        "error": None
    })

    print(f"sow_002 New Checklist Score after amendment: {analysis_res['checklist_score']}")
    for item in analysis_res["checklist_items"]:
        if "Budget" in item["name"]:
            print(f"  * {item['name']}: {item['status']} - {item['details']}")
            assert item["status"] == "PASSED", "Budget cap should now pass!"

    print(">>> Test 6 Passed!")
    print("\n" + "=" * 70)
    print("ALL PHASE 4 TESTS PASSED FLAWLESSLY!")
    print("=" * 70)

if __name__ == "__main__":
    run_tests()
