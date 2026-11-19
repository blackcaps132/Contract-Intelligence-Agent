import os
import re
from pathlib import Path
from typing import Dict, List, Tuple

def extract_text_from_file(file_path: Path) -> str:
    """Extracts raw text from .txt, .md, .docx, and .pdf files."""
    suffix = file_path.suffix.lower()
    
    if suffix in [".txt", ".md"]:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
            
    elif suffix == ".docx":
        try:
            import docx
            doc = docx.Document(str(file_path))
            full_text = []
            for p in doc.paragraphs:
                if p.text.strip():
                    full_text.append(p.text.strip())
            for t in doc.tables:
                for row in t.rows:
                    row_text = " | ".join(c.text.strip() for c in row.cells if c.text.strip())
                    if row_text:
                        full_text.append(row_text)
            return "\n\n".join(full_text)
        except Exception as e:
            raise ValueError(f"Failed to parse Word document: {str(e)}")
            
    elif suffix == ".pdf":
        try:
            import fitz # PyMuPDF
            doc = fitz.open(str(file_path))
            pages = []
            for page in doc:
                text = page.get_text()
                if text.strip():
                    pages.append(text.strip())
            return "\n\n".join(pages)
        except Exception as e:
            raise ValueError(f"Failed to parse PDF document: {str(e)}")
            
    else:
        # Fallback raw read
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()

def parse_contract_sections(text: str) -> Dict[str, str]:
    """
    Splits contract text into logical numbered sections/articles.
    Detects patterns like:
    - SECTION 1. SCOPE OF WORK
    - ARTICLE 2: INDEMNIFICATION
    - 1. DEFINITIONS
    - 3.1 Rate Schedule
    """
    sections: Dict[str, str] = {}
    
    # Common section header patterns (handles markdown hashes, Roman numerals, standard numbered outlines)
    pattern = re.compile(
        r"(^(?:#+\s*)?(?:SECTION|ARTICLE|CLAUSE)\s+[\dIVXLCDM]+(?:\.[\d]+)*[.:\s\-\–][^\n]+|"
        r"^(?:#+\s*)?\d+\.\s+[A-Z][A-Za-z0-9\s,/\-\(\)\'\".:;]{2,85}$|"
        r"^(?:#+\s*)?(?:SCHEDULE|EXHIBIT)\s+[A-Z0-9.]+[.:\s\-\–]?[^\n]*|"
        r"^(?:#+\s*)?(?:RECITALS|PREAMBLE)[^\n]*)",
        re.MULTILINE | re.IGNORECASE
    )
    
    matches = list(pattern.finditer(text))
    if not matches:
        # Fallback to paragraph splitting if no standard legal headers found
        return {"General Provisions": text}
        
    for i, match in enumerate(matches):
        sec_title = re.sub(r"^#+\s*", "", match.group(0)).strip()
        start_idx = match.end()
        end_idx = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        sec_body = text[start_idx:end_idx].strip()
        sections[sec_title] = sec_body
        
    return sections
