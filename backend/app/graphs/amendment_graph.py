"""
LangGraph Workflow: Smart Contract Modification & Redline Proposal Engine
Module 3 of the Contract Intelligence & Versioning Agent.
"""

from typing import Dict, Any
from langgraph.graph import StateGraph, END
from app.graphs.state import AmendmentGraphState
from app.services.amendment_service import propose_contract_amendment
from app.services.version_service import commit_contract_version

def draft_proposal_node(state: AmendmentGraphState) -> Dict[str, Any]:
    """
    Analyzes requested edit, locates affected contract clauses,
    generates replacement text, and creates visual word-level redline diffs.
    """
    try:
        proposal = propose_contract_amendment(
            contract_id=state["contract_id"],
            instruction=state["instruction"]
        )
        return {
            "proposal_id": proposal["proposal_id"],
            "summary_of_changes": proposal["summary_of_changes"],
            "diffs": proposal["diffs"],
            "proposed_version": proposal["proposed_version"],
            "proposed_content": proposal["proposed_content"],
            "warnings": proposal.get("warnings", []),
            "error": None
        }
    except Exception as e:
        return {
            "error": f"Failed to draft proposal: {str(e)}",
            "summary_of_changes": "Error processing amendment instruction.",
            "diffs": [],
            "proposed_version": "",
            "proposed_content": "",
            "warnings": []
        }

def commit_version_node(state: AmendmentGraphState) -> Dict[str, Any]:
    """
    Executes version commit once approved by the user / legal counsel.
    Updates SQLite database, creates diff records, and reindexes vector DB.
    """
    try:
        commit_res = commit_contract_version(
            contract_id=state["contract_id"],
            author_name=state.get("author_name") or "Legal Counsel",
            commit_message=state.get("commit_message") or f"Amend contract to {state['proposed_version']}: {state['instruction']}",
            updated_content=state["proposed_content"],
            changelog_summary=state["summary_of_changes"],
            diffs=state["diffs"]
        )
        return {
            "version_id": commit_res["version_id"],
            "approved": True
        }
    except Exception as e:
        return {
            "error": f"Failed to commit version: {str(e)}"
        }

def route_approval(state: AmendmentGraphState) -> str:
    """Conditional router based on whether human approved the commit."""
    if state.get("approved"):
        return "commit_version"
    return END

def build_amendment_graph():
    """Compiles the LangGraph StateGraph for Smart Modifications."""
    builder = StateGraph(AmendmentGraphState)

    builder.add_node("draft_proposal", draft_proposal_node)
    builder.add_node("commit_version", commit_version_node)

    builder.set_entry_point("draft_proposal")
    builder.add_conditional_edges(
        "draft_proposal",
        route_approval,
        {
            "commit_version": "commit_version",
            END: END
        }
    )
    builder.add_edge("commit_version", END)

    return builder.compile()

# Singleton instance
amendment_agent = build_amendment_graph()
