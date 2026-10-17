#!/usr/bin/env python3
"""Manual-testing helper for the order -> payment -> webhook flow (development only).

Talks to a RUNNING backend through its public API, exactly like the management web app and a kiosk would.
It never touches the database or the schema. Standard library only (Python 3.9+).

    python scripts/payment_test_data.py seed             # machine, slots, products, batches, stock, kiosk key
    python scripts/payment_test_data.py order            # new order + payment attempt, prints the QR payload
    python scripts/payment_test_data.py status --watch   # poll the order like the kiosk (every 3 s)
    python scripts/payment_test_data.py cancel           # kiosk cancel of the last order
    python scripts/payment_test_data.py mock-pay         # MOCK provider only: signed webhook marking the order paid

Admin credentials come from FVM_ADMIN_EMAIL / FVM_ADMIN_PASSWORD or are prompted (the password is never echoed or stored).
The state (ids and the kiosk key) is saved OUTSIDE the repository in ~/.fruitmachine/payment-test-data.json so it can never be committed.
With PAYMENT_PROVIDER=PAYOS the "order" command creates a REAL payOS payment link: use small whole-VND amounts.
"""
import argparse
import getpass
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from pathlib import Path

STATE = Path.home() / ".fruitmachine" / "payment-test-data.json"

# Whole-VND prices (payOS only charges integers); the fractional one exists to exercise the 409 rule.
PRODUCTS = [
    ("Test bowl 2000", "2000"),
    ("Test bowl 5000", "5000"),
    ("Test bowl 10000", "10000"),
    ("Fractional price (expect 409 on payOS)", "35000.50"),
]


class ApiError(Exception):
    pass


def call(base, method, path, body=None, token=None, kiosk_key=None, headers=None, raw=None):
    data = raw.encode("utf-8") if raw is not None else (json.dumps(body).encode("utf-8") if body is not None else None)
    request = urllib.request.Request(base.rstrip("/") + path, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    if kiosk_key:
        request.add_header("X-Kiosk-Key", kiosk_key)
    for name, value in (headers or {}).items():
        request.add_header(name, value)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            text = response.read().decode("utf-8")
            # Decimal keeps money exact (2000.00 stays 2000.00).
            return response.status, (json.loads(text, parse_float=Decimal) if text else None)
    except urllib.error.HTTPError as error:
        text = error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(text).get("message", text)
        except ValueError:
            message = text[:200]
        raise ApiError(f"{method} {path} -> HTTP {error.code}: {message}") from None
    except urllib.error.URLError as error:
        raise ApiError(f"Cannot reach {base}: {error.reason}. Is the backend running?") from None


def data_of(result):
    return (result[1] or {}).get("data")


def load_state():
    if not STATE.exists():
        sys.exit(f"No saved test data at {STATE}. Run the 'seed' command first.")
    return json.loads(STATE.read_text(encoding="utf-8"))


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2), encoding="utf-8")
    try:
        os.chmod(STATE, 0o600)
    except OSError:
        pass


def admin_token(base):
    email = os.environ.get("FVM_ADMIN_EMAIL") or input("Admin email: ").strip()
    password = os.environ.get("FVM_ADMIN_PASSWORD") or getpass.getpass("Admin password (not echoed): ")
    return data_of(call(base, "POST", "/api/v1/auth/login", {"email": email, "password": password}))["accessToken"]


def short():
    return uuid.uuid4().hex[:8].upper()


def seed(args):
    base = args.base_url
    token = admin_token(base)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    suffix = short()
    machine = data_of(call(base, "POST", "/api/v1/machines", {
        "code": f"TEST-{suffix}", "name": f"Payment test machine {suffix}", "location": "Manual test bench",
        "minTemperature": 2, "maxTemperature": 8, "minHumidity": 40, "maxHumidity": 80}, token))
    # Machines are registered INACTIVE; the kiosk can only sell from an ACTIVE machine.
    call(base, "PATCH", f"/api/v1/machines/{machine['id']}/status", {"status": "ACTIVE"}, token)
    products = []
    for index, (name, price) in enumerate(PRODUCTS, start=1):
        product = data_of(call(base, "POST", "/api/v1/products", {"sku": f"TEST-{suffix}-{index}", "name": name, "price": price}, token))
        slot = data_of(call(base, "POST", f"/api/v1/machines/{machine['id']}/slots", {"slotCode": f"A{index}", "capacity": 10}, token))
        batch = data_of(call(base, "POST", "/api/v1/product-batches", {
            "batchCode": f"TEST-{suffix}-{index}", "productId": product["id"],
            "manufacturedAt": (now - timedelta(hours=6)).isoformat().replace("+00:00", "Z"),
            "expiresAt": (now + timedelta(days=3)).isoformat().replace("+00:00", "Z"), "quantity": 10}, token))
        call(base, "POST", "/api/v1/inventory/load", {"batchId": batch["id"], "slotId": slot["id"], "quantity": args.bowls}, token)
        products.append({"id": product["id"], "name": name, "price": price, "slot": f"A{index}"})
    credential = data_of(call(base, "POST", f"/api/v1/machines/{machine['id']}/kiosk-credentials", None, token))
    state = {"baseUrl": base, "machineId": machine["id"], "machineCode": machine["code"], "kioskKey": credential["apiKey"],
             "products": products, "lastOrderId": None}
    save_state(state)
    print(f"Machine {machine['code']} ({machine['id']}) is ACTIVE with {len(products)} slots, {args.bowls} bowls each.")
    for product in products:
        print(f"  slot {product['slot']}  {product['price']:>9} VND  {product['name']}  ({product['id']})")
    print("Kiosk key (shown once, also saved for this script): " + credential["apiKey"])
    print(f"State saved to {STATE} (outside the repository). Next: python scripts/payment_test_data.py order")


def pick_product(state, args):
    if args.product:
        for product in state["products"]:
            if product["id"] == args.product or product["slot"].lower() == args.product.lower():
                return product
        sys.exit(f"Unknown product '{args.product}'. Use a slot (A1..A{len(state['products'])}) or a product id.")
    return state["products"][0]


def order(args):
    state = load_state()
    base = state["baseUrl"]
    product = pick_product(state, args)
    created = data_of(call(base, "POST", "/api/v1/kiosk/orders", {"items": [{"productId": product["id"], "quantity": args.quantity}]},
                           kiosk_key=state["kioskKey"]))
    state["lastOrderId"] = created["id"]
    save_state(state)
    print(f"Order {created['orderCode']} ({created['id']}) {created['status']}, total {created['totalAmount']} VND, hold until {created['expiresAt']}")
    try:
        status, body = call(base, "POST", f"/api/v1/kiosk/orders/{created['id']}/payments", kiosk_key=state["kioskKey"])
    except ApiError as error:
        print(f"Payment attempt not created: {error}")
        return
    payment = body["data"]
    print(f"Payment {payment['paymentId']} via {payment['provider']}: {payment['status']}, QR valid until {payment['expiresAt']}"
          + (" (reused)" if status == 200 else ""))
    print("QR payload (turn it into a QR image locally, for example: qrencode -t ANSIUTF8 '<payload>'):")
    print(payment["qrCode"])
    if payment["provider"] == "MOCK":
        print("MOCK provider: simulate the payment with  python scripts/payment_test_data.py mock-pay")
    print("Watch the kiosk view with  python scripts/payment_test_data.py status --watch")


def order_id(state, args):
    value = args.order or state.get("lastOrderId")
    if not value:
        sys.exit("No order yet. Run the 'order' command first or pass --order <id>.")
    return value


def status(args):
    state = load_state()
    base, target = state["baseUrl"], order_id(state, args)
    deadline = time.time() + args.timeout
    while True:
        current = data_of(call(base, "GET", f"/api/v1/kiosk/orders/{target}", kiosk_key=state["kioskKey"]))
        payment = current.get("currentPayment") or {}
        stamp = datetime.now().strftime("%H:%M:%S")
        print(f"{stamp}  order {current['status']:<15} payment {payment.get('status', '-'):<8} ({payment.get('provider', '-')})", flush=True)
        if not args.watch or current["status"] != "PENDING_PAYMENT" or time.time() > deadline:
            return
        time.sleep(3)


def cancel(args):
    state = load_state()
    current = data_of(call(state["baseUrl"], "POST", f"/api/v1/kiosk/orders/{order_id(state, args)}/cancel", kiosk_key=state["kioskKey"]))
    payment = current.get("currentPayment") or {}
    print(f"Order {current['orderCode']} is {current['status']}; latest payment {payment.get('status', '-')}")


def mock_pay(args):
    state = load_state()
    base, target = state["baseUrl"], order_id(state, args)
    secret = args.secret or os.environ.get("PAYMENT_MOCK_WEBHOOK_SECRET") or getpass.getpass("MOCK webhook secret (PAYMENT_MOCK_WEBHOOK_SECRET, not echoed): ")
    token = admin_token(base)
    payments = data_of(call(base, "GET", f"/api/v1/payments?orderId={target}&size=1", token=token))["content"]
    if not payments:
        sys.exit("The order has no payment attempt yet. Run 'order' (or request a payment) first.")
    payment = payments[0]
    if payment["provider"] != "MOCK":
        sys.exit(f"The latest attempt uses {payment['provider']}; mock-pay only works with PAYMENT_PROVIDER=MOCK.")
    amount = Decimal(str(args.amount)) if args.amount else payment["amount"]
    transaction = args.transaction or f"MOCK-TXN-{short()}"
    # Built by hand so the amount is written exactly as a JSON number.
    head = json.dumps({"paymentReference": payment["paymentReference"], "transactionId": transaction}, separators=(",", ":"))
    raw = head[:-1] + f',"amount":{amount},"status":"{args.status}"}}'
    # The signature covers these exact bytes; any change, even whitespace, makes it invalid.
    signature = hmac.new(secret.encode("utf-8"), raw.encode("utf-8"), hashlib.sha256).hexdigest()
    try:
        status_code, response = call(base, "POST", "/api/v1/webhooks/payments/mock", raw=raw, headers={"X-Mock-Signature": signature})
        print(f"Webhook accepted (HTTP {status_code}): {json.dumps(response)}  status={args.status} amount={amount} txn={transaction}")
    except ApiError as error:
        print(f"Webhook rejected: {error} (wrong secret, or the backend has no PAYMENT_MOCK_WEBHOOK_SECRET)")
        return
    status(argparse.Namespace(order=target, watch=False, timeout=0))


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except AttributeError:
        pass
    parser = argparse.ArgumentParser(description="Development test data for the order, payment and webhook flow.")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("seed", help="create an ACTIVE machine with stocked products and a kiosk key")
    p.add_argument("--base-url", default=os.environ.get("FVM_BASE_URL", "http://localhost:8080"))
    p.add_argument("--bowls", type=int, default=5, help="bowls loaded per slot (1..10)")
    p.set_defaults(handler=seed)
    p = sub.add_parser("order", help="create an order and a payment attempt (REAL payOS link when the provider is PAYOS)")
    p.add_argument("--product", help="slot code (A1..) or product id; default A1 (2000 VND)")
    p.add_argument("--quantity", type=int, default=1)
    p.set_defaults(handler=order)
    p = sub.add_parser("status", help="show the order as the kiosk sees it")
    p.add_argument("--order", help="order id; default the last one")
    p.add_argument("--watch", action="store_true", help="poll every 3 s while PENDING_PAYMENT")
    p.add_argument("--timeout", type=int, default=600, help="seconds to keep watching")
    p.set_defaults(handler=status)
    p = sub.add_parser("cancel", help="kiosk cancel of an order")
    p.add_argument("--order", help="order id; default the last one")
    p.set_defaults(handler=cancel)
    p = sub.add_parser("mock-pay", help="MOCK provider only: send a signed webhook for the latest attempt of the order")
    p.add_argument("--order", help="order id; default the last one")
    p.add_argument("--status", choices=["SUCCESS", "FAILED"], default="SUCCESS")
    p.add_argument("--amount", help="override the amount (use it to test PAYMENT_AMOUNT_MISMATCH)")
    p.add_argument("--transaction", help="provider transaction id; default a random one (reuse one to test conflicts)")
    p.add_argument("--secret", help="MOCK webhook secret; default PAYMENT_MOCK_WEBHOOK_SECRET or a prompt")
    p.set_defaults(handler=mock_pay)
    args = parser.parse_args()
    if args.command == "seed" and not 1 <= args.bowls <= 10:
        parser.error("--bowls must be between 1 and 10")
    try:
        args.handler(args)
    except ApiError as error:
        sys.exit(str(error))


if __name__ == "__main__":
    main()
