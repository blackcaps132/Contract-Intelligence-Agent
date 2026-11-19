import os
import re
import json
import uuid
from pathlib import Path
from datetime import datetime
from app.database import get_db, init_db

BASE_DIR = Path(__file__).resolve().parent.parent
SAMPLES_DIR = BASE_DIR / "sample_contracts"

SAMPLE_CONTRACT_CATALOG = [
    {
        "id": "sow_001_cloud_migration",
        "file": "01_IT_Services_SOW_CloudMigration.md",
        "title": "IT Services Statement of Work: Cloud Migration",
        "counterparty": "Contoso Tech Solutions LLC / Apex Cloud Consulting",
        "contract_type": "Statement of Work (SOW)",
        "status": "Pending Review",
        "description": "Enterprise cloud containerization, rate cards ($95/hr dev, $145/hr arch), and $150k budget ceiling."
    },
    {
        "id": "sow_002_marketing_growth",
        "file": "02_Marketing_Consulting_SOW_GrowthCampaign.md",
        "title": "Statement of Work: Digital Marketing Growth Services",
        "counterparty": "BrightWave Retail Inc. / Horizon Media Agency LLC",
        "contract_type": "Statement of Work (SOW)",
        "status": "Needs Changes",
        "description": "Growth campaign SOW with hourly billing. Flawed: missing Not-to-Exceed budget cap."
    },
    {
        "id": "msa_003_enterprise_standard",
        "file": "03_Enterprise_Master_Services_Agreement_MSA.md",
        "title": "Enterprise Master Services Agreement",
        "counterparty": "Global FinTech Dynamics Corp / Meridian Enterprise Solutions Inc.",
        "contract_type": "Master Services Agreement (MSA)",
        "status": "Pending Review",
        "description": "Balanced enterprise master agreement with mutual indemnity, Delaware jurisdiction, and 12-month liability cap."
    },
    {
        "id": "msa_004_vendor_favorable",
        "file": "04_Vendor_Favorable_MSA_AggressiveTerms.md",
        "title": "Commercial Services & Logistics Agreement",
        "counterparty": "OmniLogistics Corp / Titan Infrastructure Partners LLC",
        "contract_type": "Master Services Agreement (MSA)",
        "status": "Needs Changes",
        "description": "High-risk contract: uncapped customer liability, $5k vendor cap, 90-day postal evergreen renewal."
    },
    {
        "id": "saas_005_healthcare_sla",
        "file": "05_B2B_SaaS_Enterprise_Subscription_SLA.md",
        "title": "Enterprise SaaS Subscription Agreement & SLA",
        "counterparty": "NexaHealth Systems Inc. / CloudPulse Technologies Inc.",
        "contract_type": "SaaS Subscription Agreement",
        "status": "Pending Review",
        "description": "$75k annual subscription, 99.9% uptime SLA with tiered service credits, and 60-day renewal notice."
    },
    {
        "id": "nda_006_quantum_vertex",
        "file": "06_Mutual_Non_Disclosure_Agreement_MNDA.md",
        "title": "Mutual Non-Disclosure Agreement (MNDA)",
        "counterparty": "Quantum AI Labs Inc. / Vertex Robotics Inc.",
        "contract_type": "Non-Disclosure Agreement (NDA)",
        "status": "Pending Review",
        "description": "Standard bilateral NDA, 1-year disclosure period, 3-year confidentiality survival term, New York law."
    },
    {
        "id": "dpa_007_gdpr_privacy",
        "file": "07_Data_Processing_Addendum_DPA_Vendor.md",
        "title": "Data Privacy & Security Processing Addendum (DPA)",
        "counterparty": "Acme Global E-Commerce LLC / SwiftData Cloud Storage Ltd.",
        "contract_type": "Data Processing Addendum (DPA)",
        "status": "Pending Review",
        "description": "GDPR/CCPA compliance addendum with 72-hour mandatory breach notification and annual audit rights."
    },
    {
        "id": "sec_008_verizon_master",
        "file": "SEC_Verizon_Enterprise_Service_Agreement_Real.txt",
        "title": "Verizon Enterprise Services Agreement (SEC EDGAR EX-10.4)",
        "counterparty": "Verizon ABS LLC / Commercial Counterparties",
        "contract_type": "SEC EDGAR Master Agreement",
        "status": "Pending Review",
        "description": "Authentic 65-page SEC EDGAR Form 8-K enterprise service agreement with complex tiered billing schedules."
    },
    {
        "id": "sec_009_nice_outsourcing",
        "file": "SEC_NICE_Systems_Outsourcing_Agreement_Real.txt",
        "title": "NICE Systems Enterprise IT Outsourcing Agreement (SEC EX-4.5)",
        "counterparty": "NICE Systems Ltd / Enterprise Clients",
        "contract_type": "SEC EDGAR Outsourcing Agreement",
        "status": "Pending Review",
        "description": "Authentic 35-page SEC EDGAR cross-border technology outsourcing agreement with service level matrices."
    },
    {
        "id": "sec_010_zebra_ip_licensing",
        "file": "SEC_Zebra_Technologies_Intellectual_Property_Agreement_Real.txt",
        "title": "Zebra Technologies Intellectual Property Agreement (SEC EX-10.1)",
        "counterparty": "Zebra Technologies Corp / Motorola Solutions Inc.",
        "contract_type": "SEC EDGAR IP Agreement",
        "status": "Pending Review",
        "description": "Authentic 30-page SEC EDGAR patent cross-licensing and proprietary technology transfer agreement."
    }
]

def seed_database():
    init_db()
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        for item in SAMPLE_CONTRACT_CATALOG:
            file_path = SAMPLES_DIR / item["file"]
            if not file_path.exists():
                print(f"Warning: File not found: {file_path}")
                continue
                
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()

            contract_id = item["id"]
            
            # Check if contract already exists
            cursor.execute("SELECT id FROM contracts WHERE id = ?", (contract_id,))
            exists = cursor.fetchone()
            
            metadata = {
                "title": item["title"],
                "counterparty": item["counterparty"],
                "contract_type": item["contract_type"],
                "description": item["description"],
                "file_name": item["file"]
            }
            
            if not exists:
                # Insert master contract
                cursor.execute("""
                INSERT INTO contracts (id, title, counterparty, contract_type, current_version, status, metadata_json)
                VALUES (?, ?, ?, ?, 'v1.0', ?, ?)
                """, (contract_id, item["title"], item["counterparty"], item["contract_type"], item["status"], json.dumps(metadata)))
                
                # Create initial Git-style version v1.0
                version_id = f"ver_init_{contract_id[:12]}_{uuid.uuid4().hex[:6]}"
                cursor.execute("""
                INSERT INTO contract_versions (version_id, contract_id, version_tag, author_name, commit_message, full_content, changelog_summary)
                VALUES (?, ?, 'v1.0', 'Legal Operations', 'Initial executed version ingested into repository', ?, 'Initial baseline contract document on record.')
                """, (version_id, contract_id, content))
                
                print(f"✓ Seeded contract: {item['title']} (v1.0)")
            else:
                print(f"• Already exists: {item['title']}")
                
        conn.commit()

if __name__ == "__main__":
    seed_database()
    print("\nAll sample contracts seeded into database successfully!")
