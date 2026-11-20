import os
import re
import json
import logging
from typing import Dict, Any, List, Optional
from google import genai
from google.genai import types
from app.config import GEMINI_API_KEY, DEFAULT_MODEL

logger = logging.getLogger(__name__)

# Preferred models in order of speed and availability
MODEL_CANDIDATES = [
    DEFAULT_MODEL,
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.8-flash"
]

def get_genai_client() -> Optional[genai.Client]:
    """Returns an authenticated GenAI client if GEMINI_API_KEY is available."""
    if not GEMINI_API_KEY:
        return None
    try:
        return genai.Client(api_key=GEMINI_API_KEY)
    except Exception as e:
        logger.warning(f"Failed to initialize GenAI client: {e}")
        return None

def call_gemini(
    prompt: str,
    system_instruction: Optional[str] = None,
    preferred_model: Optional[str] = None
) -> Optional[str]:
    """
    Executes a prompt against Gemini with model failover and error handling.
    """
    client = get_genai_client()
    if not client:
        return None

    models_to_try = []
    if preferred_model and preferred_model not in models_to_try:
        models_to_try.append(preferred_model)
    for m in MODEL_CANDIDATES:
        if m and m not in models_to_try:
            models_to_try.append(m)

    for model_name in models_to_try:
        try:
            config = types.GenerateContentConfig()
            if system_instruction:
                config.system_instruction = system_instruction
            
            response = client.models.generate_content(
                model=model_name,
                contents=prompt,
                config=config
            )
            if response and response.text:
                return response.text.strip()
        except Exception as e:
            logger.info(f"Gemini call with {model_name} failed: {e}. Trying next candidate...")
            continue

    logger.warning("All Gemini model candidates exhausted.")
    return None

def generate_legal_qa_answer(
    query: str,
    chunks: List[Dict[str, Any]],
    contract_title: str = ""
) -> Optional[str]:
    """
    Generates a deeply grounded, professional legal answer to a counsel inquiry.
    Uses Gemini LLM when available, returning None on failure to trigger local fallback.
    """
    if not GEMINI_API_KEY:
        return None

    # Format grounded context from retrieved ChromaDB chunks
    context_blocks = []
    for c in chunks:
        sec = c.get("section_title", "General Clause")
        text = c.get("text", "").strip()
        context_blocks.append(f"### [{sec}]\n{text}")

    context_str = "\n\n".join(context_blocks)

    system_instruction = (
        "You are an elite legal contract intelligence counsel assistant.\n"
        "Your task is to provide clear, authoritative, highly structured, and objective answers "
        "to legal inquiries based STRICTLY on the provided contract excerpts.\n\n"
        "Formatting Guidelines:\n"
        "1. Provide a direct, executive answer in the opening paragraph.\n"
        "2. Break down specific rates, figures, terms, and obligations into clean markdown bullet points (•) with bold labels.\n"
        "3. Explicitly cite the governing Section name or clause number (e.g., Section 2.1, Section 5.3) for each factual point.\n"
        "4. If applicable, highlight critical risks, absence of caps, short notice periods, or notable covenants.\n"
        "5. Do NOT include generic conversational filler or repetitive boilerplates.\n"
        "6. Do NOT fabricate information not present in the excerpts."
    )

    prompt = (
        f"Contract Agreement: {contract_title or 'Governing Agreement'}\n\n"
        f"Counsel Question: {query}\n\n"
        f"--- GROUNDED CONTRACT EXCERPTS ---\n"
        f"{context_str}\n"
        f"--- END EXCERPTS ---\n\n"
        "Please provide your legal analysis and answer now:"
    )

    return call_gemini(prompt, system_instruction=system_instruction)

def generate_conflict_simulation(
    proposed_change: str,
    chunks: List[Dict[str, Any]],
    contract_title: str = ""
) -> Optional[Dict[str, Any]]:
    """
    Performs cross-clause contradiction analysis using Gemini LLM.
    Returns structured conflict report dict or None on failure.
    """
    if not GEMINI_API_KEY:
        return None

    context_blocks = []
    for c in chunks:
        sec = c.get("section_title", "General Clause")
        text = c.get("text", "").strip()
        context_blocks.append(f"[{sec}]: {text}")

    context_str = "\n\n".join(context_blocks)

    system_instruction = (
        "You are an expert contract risk and conflict simulation intelligence system.\n"
        "Your role is to analyze whether a contemplated contract amendment creates cross-clause "
        "contradictions, payment timeline clashes, financial cap breaches, or indemnification issues.\n"
        "Respond STRICTLY in valid JSON matching the requested schema."
    )

    prompt = (
        f"Contract: {contract_title or 'Current Agreement'}\n"
        f"Contemplated Modification: \"{proposed_change}\"\n\n"
        f"Existing Agreement Clauses:\n{context_str}\n\n"
        "Analyze whether this proposed change creates direct contradictions or operational risks with existing clauses.\n"
        "Return a strictly valid JSON object with this exact structure:\n"
        "{\n"
        '  "status": "CONFLICT_DETECTED" or "CLEAN_CHANGE",\n'
        '  "severity": "HIGH", "MEDIUM", "LOW", or "NONE",\n'
        '  "summary": "1-2 sentence executive assessment of the contemplated change",\n'
        '  "conflicts": [\n'
        "    {\n"
        '      "section_ref": "Exact Section Name from excerpts",\n'
        '      "conflicting_text": "Verbatim excerpt of the conflicting language",\n'
        '      "explanation": "Precise legal explanation of why the change contradicts this clause",\n'
        '      "severity": "HIGH" or "MEDIUM"\n'
        "    }\n"
        "  ],\n"
        '  "recommendations": [\n'
        '    "Actionable step to resolve this contradiction or protect the party"\n'
        "  ],\n"
        '  "harmonized_draft": "Draft amendment clause reconciling the contemplated change with existing provisions"\n'
        "}\n"
        "Output ONLY the JSON object. No Markdown code fences or extra text."
    )

    raw_res = call_gemini(prompt, system_instruction=system_instruction)
    if not raw_res:
        return None

    # Clean markdown fences if any
    cleaned_res = re.sub(r"^```(?:json)?\s*", "", raw_res.strip())
    cleaned_res = re.sub(r"\s*```$", "", cleaned_res.strip())

    try:
        report = json.loads(cleaned_res)
        report["proposed_change"] = proposed_change
        report["conflict_count"] = len(report.get("conflicts", []))
        report["analyzed_clauses"] = [c.get("section_title", "") for c in chunks]
        return report
    except Exception as e:
        logger.warning(f"Failed to parse LLM conflict response as JSON: {e}\nRaw: {raw_res[:200]}")
        return None

def generate_contract_amendment_llm(
    contract_content: str,
    instruction: str,
    contract_title: str = ""
) -> Optional[Dict[str, Any]]:
    """
    Uses Gemini LLM to draft clause amendments and replacements for any natural-language prompt.
    Returns structured modifications dict or None on failure.
    """
    if not GEMINI_API_KEY:
        return None

    system_instruction = (
        "You are an elite legal contract drafting specialist and redline revision expert.\n"
        "Your task is to analyze an amendment instruction, identify which exact section(s) in the contract "
        "must be updated, and provide exact before and after text.\n"
        "Strict Rules:\n"
        "1. Identify the specific section number and section title to modify.\n"
        "2. The 'original_text' MUST be an exact verbatim substring from the contract content so it can be cleanly matched and replaced.\n"
        "3. The 'amended_text' must be the complete, professionally drafted replacement for that exact substring.\n"
        "4. Provide a clear rationale explaining the legal and commercial intent of the change.\n"
        "5. Provide a short, concise, and meaningful Git-style commit message under 60 characters describing the substantive legal amendment (e.g. 'Section 5.1: Extend termination notice to 30 days' or 'Section 4.1: Add $195k budget cap'). Never use '...' or truncate words in the commit message.\n"
        "6. If the change creates contradictions with other provisions, list them in 'warnings'.\n"
        "7. Respond STRICTLY in valid JSON matching the requested schema."
    )

    prompt = (
        f"Contract: {contract_title or 'Governing Agreement'}\n"
        f"Amendment Instruction: \"{instruction}\"\n\n"
        f"--- FULL CONTRACT CONTENT ---\n"
        f"{contract_content[:24000]}\n"
        f"--- END CONTRACT CONTENT ---\n\n"
        "Return a strictly valid JSON object with this exact structure:\n"
        "{\n"
        '  "commit_message": "Short, concise Git commit message under 60 chars without trailing ellipsis (e.g. Section 5.1: Extend termination notice to 30 days)",\n'
        '  "summary_of_changes": "Clear executive summary of all proposed modifications",\n'
        '  "modifications": [\n'
        "    {\n"
        '      "section_number": "Section Number (e.g. Section 2.1 or Section 3.2)",\n'
        '      "section_title": "Section Title (e.g. Rate Card or Invoicing)",\n'
        '      "original_text": "Exact verbatim excerpt from the contract to replace",\n'
        '      "amended_text": "Exact replacement text incorporating the requested change",\n'
        '      "rationale": "Why this specific change was made"\n'
        "    }\n"
        "  ],\n"
        '  "warnings": ["Any contradiction or cross-clause risk warnings"]\n'
        "}\n"
        "Output ONLY the JSON object. No Markdown code fences or extra text."
    )

    raw_res = call_gemini(prompt, system_instruction=system_instruction)
    if not raw_res:
        return None

    cleaned_res = re.sub(r"^```(?:json)?\s*", "", raw_res.strip())
    cleaned_res = re.sub(r"\s*```$", "", cleaned_res.strip())

    try:
        data = json.loads(cleaned_res)
        if "modifications" in data and len(data["modifications"]) > 0:
            return data
    except Exception as e:
        logger.warning(f"Failed to parse LLM amendment JSON: {e}\nRaw: {raw_res[:200]}")

    return None
