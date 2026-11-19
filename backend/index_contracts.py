import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE_DIR))

from app.services.vector_service import index_all_contracts_in_db

def main():
    print("Indexing all contracts from SQLite into ChromaDB...")
    stats = index_all_contracts_in_db()
    total_chunks = sum(stats.values())
    print(f"\n✓ Successfully indexed {len(stats)} contracts into ChromaDB!")
    print(f"✓ Total semantic clause chunks stored: {total_chunks}")
    print("\nBreakdown by contract:")
    for c_id, count in stats.items():
        print(f"  • {c_id}: {count} chunks")

if __name__ == "__main__":
    main()
