import os
from pathlib import Path
from dotenv import load_dotenv
import pg8000.native

load_dotenv(Path(__file__).parent.parent / ".env")

conn = pg8000.native.Connection(
    user=os.environ.get("DB_USER"),
    password=os.environ.get("DB_PASSWORD"),
    host=os.environ.get("DB_HOST"),
    port=int(os.environ.get("DB_PORT", 5432)),
    database=os.environ.get("DB_NAME", "postgres"),
    ssl_context=True,
)

print("Connected to Supabase PostgreSQL.")
rows = conn.run("SELECT id, slot_id, status FROM inventory_items WHERE status = 'DISPENSE_FAILED'")
print(f"Found {len(rows)} DISPENSE_FAILED items: {rows}")

if rows:
    conn.run("UPDATE inventory_items SET status = 'AVAILABLE' WHERE status = 'DISPENSE_FAILED'")
    print("Updated all DISPENSE_FAILED items to AVAILABLE.")

# Also release any stale allocations so new orders can allocate these items
conn.run("""
    UPDATE order_item_allocations 
    SET status = 'RELEASED', released_at = NOW(), updated_at = NOW() 
    WHERE status IN ('RESERVED', 'DISPENSED') 
      AND inventory_item_id IN (SELECT id FROM inventory_items WHERE status = 'AVAILABLE')
""")
print("Released stale allocations for all available items.")

# Check current sellable heads
heads = conn.run("""
    WITH heads AS (
        SELECT DISTINCT ON (i.slot_id) i.slot_id, i.status, i.batch_id, i.id
        FROM inventory_items i JOIN machine_slots s ON s.id = i.slot_id
        WHERE i.status IN ('AVAILABLE', 'RESERVED', 'EXPIRED', 'DISPENSE_FAILED')
        ORDER BY i.slot_id, i.loaded_at, i.id
    )
    SELECT h.slot_id, s.slot_code, h.status, p.name, p.price, h.id
    FROM heads h
    JOIN product_batches pb ON pb.id = h.batch_id
    JOIN products p ON p.id = pb.product_id
    JOIN machine_slots s ON s.id = h.slot_id
""")
print("Current Slot Heads:")
for h in heads:
    print(f"  Slot {h[1]} ({h[0]}): Status={h[2]}, Product={h[3]} ({h[4]} VND), ItemId={h[5]}")

conn.close()
