import io
import re
from datetime import datetime
from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement, parse_xml
from docx.oxml.ns import nsdecls, qn

from app.database import get_db

def set_cell_background(cell, hex_color: str):
    """Sets background color of a table cell."""
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = parse_xml(f'<w:shd {nsdecls("w")} w:fill="{hex_color}"/>')
    tc_pr.append(shd)

def generate_contract_docx(contract_id: str, version_tag: str = None) -> io.BytesIO:
    """
    Generates a professionally formatted Microsoft Word (.docx) file
    from a specific contract version snapshot (or the current version).
    """
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Fetch contract metadata
        cursor.execute("SELECT * FROM contracts WHERE id = ?", (contract_id,))
        contract = cursor.fetchone()
        if not contract:
            raise ValueError(f"Contract {contract_id} not found.")

        target_version = version_tag or contract["current_version"]

        # 2. Fetch specific version content
        cursor.execute("""
        SELECT * FROM contract_versions
        WHERE contract_id = ? AND version_tag = ?
        """, (contract_id, target_version))
        ver_row = cursor.fetchone()
        
        if not ver_row:
            # Fallback to current if requested tag not found
            cursor.execute("""
            SELECT * FROM contract_versions
            WHERE contract_id = ?
            ORDER BY created_at DESC LIMIT 1
            """, (contract_id,))
            ver_row = cursor.fetchone()

    doc = Document()

    # Set page margins (1 inch)
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(1)
        section.bottom_margin = Inches(1)
        section.left_margin = Inches(1)
        section.right_margin = Inches(1)

    # 1. Document Title
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(0)
    title_p.paragraph_format.space_after = Pt(6)
    title_run = title_p.add_run(contract["title"].upper())
    title_run.font.name = "Arial"
    title_run.font.size = Pt(18)
    title_run.font.bold = True
    title_run.font.color.rgb = RGBColor(30, 58, 138) # Corporate Navy Blue

    # Subtitle / Version tag
    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_after = Pt(16)
    sub_run = sub_p.add_run(f"Version: {ver_row['version_tag']} | Status: {contract['status']} | Last Modified: {ver_row['created_at'][:10]}")
    sub_run.font.name = "Arial"
    sub_run.font.size = Pt(10)
    sub_run.font.italic = True
    sub_run.font.color.rgb = RGBColor(100, 116, 139) # Muted Slate

    # 2. Executive Metadata Box (Table)
    meta_table = doc.add_table(rows=3, cols=2)
    meta_table.alignment = WD_TABLE_ALIGNMENT.CENTER
    meta_table.autofit = False

    meta_data = [
        ("Counterparty:", contract["counterparty"], "Contract Type:", contract["contract_type"]),
        ("Current Version:", ver_row["version_tag"], "Author / Counsel:", ver_row["author_name"]),
        ("Commit Message:", ver_row["commit_message"], "Export Timestamp:", datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"))
    ]

    for row_idx, (k1, v1, k2, v2) in enumerate(meta_data):
        row = meta_table.rows[row_idx]
        
        # Cell 1
        p1 = row.cells[0].paragraphs[0]
        r1_k = p1.add_run(f"{k1} ")
        r1_k.font.bold = True
        r1_k.font.size = Pt(9.5)
        r1_v = p1.add_run(str(v1))
        r1_v.font.size = Pt(9.5)

        # Cell 2
        p2 = row.cells[1].paragraphs[0]
        r2_k = p2.add_run(f"{k2} ")
        r2_k.font.bold = True
        r2_k.font.size = Pt(9.5)
        r2_v = p2.add_run(str(v2))
        r2_v.font.size = Pt(9.5)

        set_cell_background(row.cells[0], "F8FAFC")
        set_cell_background(row.cells[1], "F8FAFC")

    # Divider line
    div_p = doc.add_paragraph()
    div_p.paragraph_format.space_before = Pt(12)
    div_p.paragraph_format.space_after = Pt(16)
    div_run = div_p.add_run("_________________________________________________________________________________")
    div_run.font.color.rgb = RGBColor(203, 213, 225)

    # 3. Contract Body Text
    raw_content = ver_row["full_content"]
    lines = raw_content.split("\n")

    sec_regex = re.compile(
        r'^(?:#+\s*)?(?:SECTION|ARTICLE|CLAUSE)?\s*(\d+(?:\.\d+)*)[:.\-\s]+([^\n\r]+)',
        re.IGNORECASE
    )

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        # Check if heading
        is_heading = False
        if stripped.startswith("#"):
            is_heading = True
            heading_text = stripped.lstrip("#").strip()
            level = min(stripped.count("#"), 3)
        elif ("SECTION" in stripped.upper() or "ARTICLE" in stripped.upper()) and sec_regex.match(stripped):
            is_heading = True
            heading_text = stripped
            level = 2
        else:
            is_heading = False

        if is_heading:
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(14)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.keep_with_next = True
            run = p.add_run(heading_text)
            run.font.name = "Arial"
            run.font.bold = True
            run.font.size = Pt(12)
            run.font.color.rgb = RGBColor(15, 23, 42)
        else:
            p = doc.add_paragraph()
            p.paragraph_format.space_before = Pt(0)
            p.paragraph_format.space_after = Pt(4)
            p.paragraph_format.line_spacing = 1.15
            run = p.add_run(stripped)
            run.font.name = "Arial"
            run.font.size = Pt(10)
            run.font.color.rgb = RGBColor(51, 65, 85)

    # Output to in-memory bytes
    file_stream = io.BytesIO()
    doc.save(file_stream)
    file_stream.seek(0)
    return file_stream
