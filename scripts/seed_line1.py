import urllib.request
import json
import os
import datetime
import uuid
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

base = "http://localhost:8080"
email = os.environ.get("INITIAL_ADMIN_EMAIL", "hoaise184132@fpt.edu.vn")
password = os.environ.get("INITIAL_ADMIN_PASSWORD", "Admin12345678")

# 1. Login
req = urllib.request.Request(
    base + "/api/v1/auth/login",
    data=json.dumps({"email": email, "password": password}).encode("utf-8"),
    headers={"Content-Type": "application/json", "Accept": "application/json"}
)
with urllib.request.urlopen(req) as resp:
    token = json.loads(resp.read().decode())["data"]["accessToken"]

print("Logged in as admin successfully.")

# 2. Create a new batch for Mixed fruit bowl (Line 1)
now = datetime.datetime.now(datetime.timezone.utc)
batch_code = "MIX-" + uuid.uuid4().hex[:6].upper()
batch_data = {
    "batchCode": batch_code,
    "productId": "40000000-0000-0000-0000-000000000001",
    "manufacturedAt": (now - datetime.timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "expiresAt": (now + datetime.timedelta(days=14)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "quantity": 10
}
req = urllib.request.Request(
    base + "/api/v1/product-batches",
    data=json.dumps(batch_data).encode("utf-8"),
    headers={"Content-Type": "application/json", "Accept": "application/json", "Authorization": "Bearer " + token}
)
with urllib.request.urlopen(req) as resp:
    batch = json.loads(resp.read().decode())["data"]
print(f"Created batch {batch['batchCode']} (ID: {batch['id']})")

# 3. Load 10 bowls into Slot A (Line 1)
load_data = {
    "batchId": batch["id"],
    "slotId": "f9d1945a-e8ee-4cd6-96c1-6233c7e8317e",
    "quantity": 10
}
req = urllib.request.Request(
    base + "/api/v1/inventory/load",
    data=json.dumps(load_data).encode("utf-8"),
    headers={"Content-Type": "application/json", "Accept": "application/json", "Authorization": "Bearer " + token}
)
with urllib.request.urlopen(req) as resp:
    loaded = json.loads(resp.read().decode())["data"]
print("Successfully loaded 10 bowls into Slot A (Line 1)!")

# 4. Check kiosk catalog
kiosk_key = "fvk_afa2xys39uu4_Hkaq5wKM1Aktfb52429P6XIsyH5n_yM9EHhAlGCU6tU"
req = urllib.request.Request(
    base + "/api/v1/kiosk/catalog",
    headers={"Accept": "application/json", "X-Kiosk-Key": kiosk_key}
)
with urllib.request.urlopen(req) as resp:
    catalog = json.loads(resp.read().decode())["data"]
print("\nCurrent Kiosk Catalog:")
for p in catalog.get("products", []):
    print(f"  - {p['name']} ({p['price']} VND) : {p['availableQuantity']} hộp có sẵn")
