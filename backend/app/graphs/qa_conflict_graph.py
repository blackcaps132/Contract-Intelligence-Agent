import re
from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, START, END
from app.services.vector_service import query_contract_clauses
from app.services.conflict_service import simulate_cross_clause_conflict

class QAConflictGraphState(TypedDict):
    """LangGraph state schema for Q&A and Conflict Simulation."""
    contract_id: str
    user_query: str
    query_type: str                  # "QUESTION" vs "PROPOSED_CHANGE"
    retrieved_chunks: List[Dict[str, Any]]
    answer: str
    citations: List[Dict[str, Any]]
    conflict_report: Optional[Dict[str, Any]]

# --- NODE 1: Classify Query Type ---
def classify_query_node(state: QAConflictGraphState) -> Dict[str, Any]:
    query = state["user_query"].strip().lower()
    
    change_triggers = [
        "change", "modify", "thinking of", "what if", "if i change",
        "conflict", "conflicts", "will it have any conflict",
        "raise", "increase", "switch to", "update", "amend", "alter"
    ]
    
    is_change = any(trigger in query for trigger in change_triggers)
    query_type = "PROPOSED_CHANGE" if is_change else "QUESTION"
    
    return {"query_type": query_type}

# --- NODE 2: Retrieve Chunks from ChromaDB ---
def retrieve_chunks_node(state: QAConflictGraphState) -> Dict[str, Any]:
    contract_id = state["contract_id"]
    query = state["user_query"]
    
    chunks = query_contract_clauses(contract_id, query, top_k=4)
    return {"retrieved_chunks": chunks}

# --- NODE 3A: Answer Question ---
def answer_question_node(state: QAConflictGraphState) -> Dict[str, Any]:
    query = state["user_query"]
    chunks = state.get("retrieved_chunks", [])
    
    if not chunks:
        return {
            "answer": "No directly relevant clauses found in this contract for the requested inquiry.",
            "citations": []
        }

    # Synthesize grounded answer
    citations = []
    summary_parts = []
    
    for c in chunks:
        citations.append({
            "section": c["section_title"],
            "snippet": c["text"][:250] + "..." if len(c["text"]) > 250 else c["text"],
            "relevance": c["relevance_score"]
        })
        summary_parts.append(f"According to **{c['section_title']}**:\n> \"{c['text'][:300]}\"")

    # Tailored synthesis for common questions
    q_lower = query.lower()
    if "deadline" in q_lower or "notice" in q_lower or "termination" in q_lower:
        direct_answer = f"Based on the contract text, the notice and deadline requirements are defined in **{citations[0]['section']}**.\n\n"
    elif "rate" in q_lower or "hourly" in q_lower or "cost" in q_lower:
        direct_answer = f"The financial rates and pricing terms are established in **{citations[0]['section']}**.\n\n"
    elif "sla" in q_lower or "uptime" in q_lower or "credit" in q_lower:
        direct_answer = f"The service level commitments and penalty credits are governed by **{citations[0]['section']}**.\n\n"
    else:
        direct_answer = f"The relevant contractual provisions are located in **{citations[0]['section']}**.\n\n"

    full_answer = direct_answer + "\n\n".join(summary_parts[:2])

    return {
        "answer": full_answer,
        "citations": citations,
        "conflict_report": None
    }

# --- NODE 3B: Simulate Conflict ---
def simulate_conflict_node(state: QAConflictGraphState) -> Dict[str, Any]:
    contract_id = state["contract_id"]
    query = state["user_query"]
    
    report = simulate_cross_clause_conflict(contract_id, query)
    
    citations = []
    for c in state.get("retrieved_chunks", []):
        citations.append({
            "section": c["section_title"],
            "snippet": c["text"][:200] + "...",
            "relevance": c["relevance_score"]
        })

    if report["status"] == "CONFLICT_DETECTED":
        ans = (
            f"⚠️ **CROSS-CLAUSE CONFLICT DETECTED ({report['severity']} SEVERITY)**\n\n"
            f"If you execute the proposed change: *'{query}'*, it creates **{report['conflict_count']} contradiction(s)** "
            f"with existing provisions:\n\n"
        )
        for conf in report["conflicts"]:
            ans += f"• **{conf['section_ref']}**: {conf['explanation']}\n  *Snippet:* \"{conf['conflicting_text']}\"\n\n"
        ans += "**Recommended Actions Before Proceeding:**\n"
        for rec in report["recommendations"]:
            ans += f"→ {rec}\n"
    else:
        ans = (
            f"✅ **NO DIRECT CONFLICT DETECTED**\n\n"
            f"The contemplated change *'{query}'* does not trigger obvious contradictions with existing terms in this agreement.\n"
        )
        for rec in report["recommendations"]:
            ans += f"→ {rec}\n"

    return {
        "answer": ans,
        "citations": citations,
        "conflict_report": report
    }

# --- ROUTER CONDITIONAL EDGE ---
def route_query_type(state: QAConflictGraphState) -> str:
    return "simulate_conflict" if state["query_type"] == "PROPOSED_CHANGE" else "answer_question"

# --- BUILD LANGGRAPH WORKFLOW ---
def build_qa_conflict_graph():
    workflow = StateGraph(QAConflictGraphState)

    workflow.add_node("classify_query", classify_query_node)
    workflow.add_node("retrieve_chunks", retrieve_chunks_node)
    workflow.add_node("answer_question", answer_question_node)
    workflow.add_node("simulate_conflict", simulate_conflict_node)

    workflow.add_edge(START, "classify_query")
    workflow.add_edge("classify_query", "retrieve_chunks")
    
    # Conditional branching: Question vs Contemplated Change
    workflow.add_conditional_edges(
        "retrieve_chunks",
        route_query_type,
        {
            "answer_question": "answer_question",
            "simulate_conflict": "simulate_conflict"
        }
    )

    workflow.add_edge("answer_question", END)
    workflow.add_edge("simulate_conflict", END)

    return workflow.compile()

# Pre-compiled instance
qa_conflict_agent = build_qa_conflict_graph()
