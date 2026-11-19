import os
import re
import chromadb
from pathlib import Path
from typing import List, Dict, Any, Optional
from app.config import CHROMA_DIR
from app.services.parser_service import parse_contract_sections
from app.database import get_db

# Persistent ChromaDB client
_client = None
_collection = None

def get_chroma_collection():
    """Initializes and returns the persistent ChromaDB collection."""
    global _client, _collection
    if _collection is None:
        _client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        # Uses Chroma's fast, built-in ONNX all-MiniLM-L6-v2 local embeddings
        _collection = _client.get_or_create_collection(
            name="contract_clauses",
            metadata={"description": "Contract clauses with section-level semantic embeddings"}
        )
    return _collection

def chunk_section_text(sec_title: str, sec_text: str, max_chunk_chars: int = 800) -> List[str]:
    """Splits a section into readable paragraph chunks while preserving section context."""
    paragraphs = [p.strip() for p in sec_text.split("\n\n") if p.strip()]
    if not paragraphs:
        return [f"{sec_title}: {sec_text}"] if sec_text.strip() else []
        
    chunks = []
    current_chunk = f"[{sec_title}]\n"
    
    for p in paragraphs:
        if len(current_chunk) + len(p) > max_chunk_chars:
            chunks.append(current_chunk.strip())
            current_chunk = f"[{sec_title}]\n{p}\n"
        else:
            current_chunk += f"{p}\n"
            
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
        
    return chunks

def index_contract(contract_id: str, title: str, content: str) -> int:
    """Indexes an individual contract's sections and clauses into ChromaDB."""
    collection = get_chroma_collection()
    
    # 1. Clean existing chunks for this contract to avoid stale duplicates
    try:
        existing = collection.get(where={"contract_id": contract_id})
        if existing and existing.get("ids"):
            collection.delete(ids=existing["ids"])
    except Exception:
        pass

    # 2. Parse sections
    sections = parse_contract_sections(content)
    
    doc_ids = []
    documents = []
    metadatas = []
    
    chunk_counter = 0
    for sec_title, sec_body in sections.items():
        chunks = chunk_section_text(sec_title, sec_body)
        for chunk in chunks:
            chunk_id = f"{contract_id}_chunk_{chunk_counter}"
            doc_ids.append(chunk_id)
            documents.append(chunk)
            metadatas.append({
                "contract_id": contract_id,
                "contract_title": title,
                "section_title": sec_title[:100],
                "chunk_index": chunk_counter
            })
            chunk_counter += 1

    if documents:
        collection.add(
            ids=doc_ids,
            documents=documents,
            metadatas=metadatas
        )

    return len(documents)

def query_contract_clauses(contract_id: str, query: str, top_k: int = 4) -> List[Dict[str, Any]]:
    """Performs semantic vector search filtered strictly to the given contract_id."""
    collection = get_chroma_collection()
    
    results = collection.query(
        query_texts=[query],
        where={"contract_id": contract_id},
        n_results=top_k
    )
    
    retrieved = []
    if results and results.get("documents") and results["documents"][0]:
        docs = results["documents"][0]
        metas = results["metadatas"][0] if results.get("metadatas") else [{}] * len(docs)
        distances = results["distances"][0] if results.get("distances") else [0.0] * len(docs)
        
        for doc, meta, dist in zip(docs, metas, distances):
            retrieved.append({
                "text": doc,
                "section_title": meta.get("section_title", "General Provision"),
                "contract_id": meta.get("contract_id", contract_id),
                "relevance_score": round(max(0.0, 1.0 - (dist if dist is not None else 0.5)), 3)
            })
            
    return retrieved

def index_all_contracts_in_db() -> Dict[str, int]:
    """Indexes all contracts currently stored in the SQLite database."""
    stats = {}
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        SELECT c.id, c.title, v.full_content 
        FROM contracts c
        JOIN contract_versions v ON c.id = v.contract_id AND c.current_version = v.version_tag
        """)
        rows = cursor.fetchall()
        
        for row in rows:
            c_id = row["id"]
            title = row["title"]
            content = row["full_content"]
            count = index_contract(c_id, title, content)
            stats[c_id] = count
            
    return stats
