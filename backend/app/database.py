import sqlite3
import os
from contextlib import contextmanager
from pathlib import Path

# Database path in backend/data/contracts.db
BASE_DIR = Path(__file__).resolve().parent.parent
DB_DIR = BASE_DIR / "data"
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "contracts.db"

def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

@contextmanager
def get_db():
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db():
    """Initializes the SQLite schema with contracts, versions, and diff tables."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Contracts master table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS contracts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            counterparty TEXT NOT NULL,
            contract_type TEXT NOT NULL,
            current_version TEXT NOT NULL DEFAULT 'v1.0',
            status TEXT NOT NULL DEFAULT 'Active',
            checklist_score TEXT DEFAULT 'Pending Analysis',
            checklist_json TEXT DEFAULT '[]',
            risk_flags_json TEXT DEFAULT '[]',
            metadata_json TEXT DEFAULT '{}',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        """)

        # 2. Contract versions table (Git-style Commits)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS contract_versions (
            version_id TEXT PRIMARY KEY,
            contract_id TEXT NOT NULL,
            version_tag TEXT NOT NULL,
            author_name TEXT NOT NULL,
            commit_message TEXT NOT NULL,
            full_content TEXT NOT NULL,
            changelog_summary TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (contract_id) REFERENCES contracts (id) ON DELETE CASCADE
        );
        """)

        # 3. Clause diffs table (detailed changes per commit)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS version_diffs (
            id TEXT PRIMARY KEY,
            version_id TEXT NOT NULL,
            section_number TEXT NOT NULL,
            section_title TEXT NOT NULL,
            before_text TEXT NOT NULL,
            after_text TEXT NOT NULL,
            rationale TEXT NOT NULL,
            FOREIGN KEY (version_id) REFERENCES contract_versions (version_id) ON DELETE CASCADE
        );
        """)
        
        conn.commit()

if __name__ == "__main__":
    init_db()
    print(f"Database initialized successfully at: {DB_PATH}")
