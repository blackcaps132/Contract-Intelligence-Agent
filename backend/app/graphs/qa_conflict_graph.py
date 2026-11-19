import re
from typing import TypedDict, List, Dict, Any, Optional
from langgraph.graph import StateGraph, START, END
from app.services.vector_service import query_contract_clauses
from app.services.conflict_service import simulate_cross_clause_conflict
from app.services.llm_service import generate_legal_qa_answer
from app.config import GEMINI_API_KEY

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

    # Clean citations
    citations = []
    for c in chunks:
        clean_text = re.sub(r"^\[.*?\]\s*", "", c["text"]).strip()
        citations.append({
            "section": c["section_title"],
            "snippet": clean_text[:280] + "..." if len(clean_text) > 280 else clean_text,
            "relevance": c["relevance_score"]
        })

    # 1. Try Gemini LLM for dynamic, intelligent legal analysis
    if GEMINI_API_KEY:
        try:
            llm_answer = generate_legal_qa_answer(
                query=query,
                chunks=chunks,
                contract_title=state.get("contract_id", "")
            )
            if llm_answer and len(llm_answer.strip()) > 20:
                return {
                    "answer": llm_answer.strip(),
                    "citations": citations,
                    "conflict_report": None
                }
        except Exception:
            pass

    q_lower = query.lower()
    top_sec = citations[0]["section"]

    # 1. Rate queries
    if "rate" in q_lower or "hourly" in q_lower or "cost" in q_lower or "fee" in q_lower:
        rate_lines = []
        for c in chunks:
            clean = re.sub(r"^\[.*?\]\s*", "", c["text"]).strip()
            for line in clean.split("\n"):
                if re.search(r"\$\d+(?:\.\d{2})?\s*(?:/hr|per\s+hour)", line, re.IGNORECASE):
                    clean_line = line.strip("• -* \t")
                    if clean_line and clean_line not in rate_lines:
                        rate_lines.append(clean_line)

        if rate_lines:
            bullets = "\n".join([f"• **{l}**" for l in rate_lines[:5]])
            ans = (
                f"The resource billing rates are governed by **{top_sec}**:\n\n"
                f"{bullets}\n\n"
                f"These rates remain firm and fixed for the duration of the agreement unless modified by mutual written amendment."
            )
        else:
            ans = f"The pricing and compensation terms are established in **{top_sec}**."

    # 2. Termination / Notice queries
    elif "deadline" in q_lower or "notice" in q_lower or "termination" in q_lower or "cancel" in q_lower:
        notice_match = None
        for c in chunks:
            m = re.search(r"(\d+\s*days?(?:'|\s+)prior\s+written\s+notice|upon\s+\d+\s+days\s+notice)", c["text"], re.IGNORECASE)
            if m:
                notice_match = m.group(0)
                break
        if notice_match:
            ans = (
                f"Based on **{top_sec}**, convenience termination requires **{notice_match}**.\n\n"
                f"Either party may terminate the agreement pursuant to the written notice requirements specified in this provision."
            )
        else:
            ans = f"The termination rights, survival terms, and notice windows are defined in **{top_sec}**."

    # 3. Budget cap / Not-to-Exceed queries
    elif "budget" in q_lower or "cap" in q_lower or "ceiling" in q_lower or "not-to-exceed" in q_lower or "nte" in q_lower:
        cap_val = None
        has_no_cap = False
        for c in chunks:
            m = re.search(r"(?:not-to-exceed|budget\s+ceiling|shall\s+not\s+exceed)[^\$]{0,50}\$([0-9,]+(?:\.\d{2})?)", c["text"], re.IGNORECASE)
            if m:
                cap_val = f"${m.group(1)}"
                break
            if re.search(r"no\s+maximum\s+fee|no\s+budget\s+cap|without\s+limitation|no\s+cap", c["text"], re.IGNORECASE):
                has_no_cap = True

        if has_no_cap and not cap_val:
            ans = (
                f"⚠️ **Open-Ended Financial Risk:** According to **{top_sec}**, this contract contains **no Not-to-Exceed (NTE) budget cap**.\n\n"
                f"Services are billed on an actual-hours Time & Materials basis without an aggregate spending ceiling."
            )
        elif cap_val:
            ans = (
                f"According to **{top_sec}**, the total cumulative fees are subject to an explicit Not-to-Exceed budget cap of **{cap_val} USD**.\n\n"
                f"Work exceeding this financial threshold requires a formal prior written amendment."
            )
        else:
            ans = f"Budget and financial ceiling provisions are located in **{top_sec}**."

    # 4. Liability / Indemnification queries
    elif "liability" in q_lower or "indemn" in q_lower or "damage" in q_lower:
        ans = (
            f"Liability limits, indemnifications, and risk allocations are set forth in **{top_sec}**.\n\n"
            f"Please review the Grounded Section Citations below for exact limitation clauses and mutual indemnification terms."
        )

    # 5. General inquiries
    else:
        ans = (
            f"The relevant contractual provisions regarding your inquiry are located in **{top_sec}**.\n\n"
            f"Please consult the Grounded Section Citations below for verbatim extracts from this agreement."
        )

    return {
        "answer": ans,
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
        clean_text = re.sub(r"^\[.*?\]\s*", "", c["text"]).strip()
        citations.append({
            "section": c["section_title"],
            "snippet": clean_text[:280] + "..." if len(clean_text) > 280 else clean_text,
            "relevance": c["relevance_score"]
        })

    if report.get("status") == "CONFLICT_DETECTED":
        summary = report.get("summary", "")
        ans = f"⚠️ **CROSS-CLAUSE CONFLICT DETECTED ({report.get('severity', 'HIGH')} SEVERITY)**\n\n"
        if summary:
            ans += f"{summary}\n\n"
        else:
            ans += f"Executing the contemplated change *'{query}'* creates **{report.get('conflict_count', 1)} contradiction(s)** with existing provisions:\n\n"

        for conf in report.get("conflicts", []):
            ans += f"• **{conf.get('section_ref', 'Clause')}**: {conf.get('explanation', '')}\n"
            if conf.get("conflicting_text"):
                ans += f"  > *\"{conf['conflicting_text']}\"*\n\n"

        if report.get("recommendations"):
            ans += "**Recommended Harmonization Actions:**\n"
            for rec in report["recommendations"]:
                ans += f"• {rec}\n"

        if report.get("harmonized_draft"):
            ans += f"\n**Suggested Harmonized Replacement:**\n> {report['harmonized_draft']}\n"
    else:
        summary = report.get("summary") or f"The contemplated modification *'{query}'* does not trigger direct contradictions with the analyzed clauses in this agreement."
        ans = (
            f"✅ **NO DIRECT CONFLICT DETECTED**\n\n"
            f"{summary}\n\n"
        )
        if report.get("recommendations"):
            ans += "**Observations & Counsel Notes:**\n"
            for rec in report["recommendations"]:
                ans += f"• {rec}\n"

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
