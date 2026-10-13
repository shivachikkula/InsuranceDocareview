"""Generates demo claim documents for the AUTO-100234 policy (seeded for alice@example.com).

clean/      consistent claim form, invoice and photo  -> should reach READY_FOR_APPROVAL
suspicious/ invoice predates the incident, total is higher than claimed and the
            repair shop is on the watchlist          -> should be flagged for MANUAL_REVIEW
"""
from pathlib import Path

from PIL import Image, ImageDraw
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

HERE = Path(__file__).parent


def pdf(path: Path, title: str, lines: list[str]) -> None:
    c = canvas.Canvas(str(path), pagesize=LETTER)
    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, 720, title)
    c.setFont("Helvetica", 11)
    y = 690
    for line in lines:
        c.drawString(72, y, line)
        y -= 18
    c.save()


def claim_form(path: Path) -> None:
    pdf(path, "Auto Insurance Claim Form", [
        "Policy number: AUTO-100234",
        "Policyholder: Alice Claimant",
        "Vehicle: 2021 Toyota Camry, VIN 4T1B11HK5MU123456",
        "Date of loss: 2026-09-14",
        "Location: Intersection of Main St and 3rd Ave, Springfield",
        "Description: Vehicle was stopped at a red light and was rear-ended by",
        "another vehicle. Rear bumper, trunk lid and left tail light damaged.",
        "Police report number: SPD-2026-55817",
        "Amount claimed: $4,850.00",
        "Signature: Alice Claimant        Date: 2026-09-18",
    ])


def invoice(path: Path, shop: str, date: str, items: list[tuple[str, float]]) -> None:
    total = sum(amount for _, amount in items)
    lines = [
        f"Repair shop: {shop}",
        f"Invoice date: {date}",
        "Customer: Alice Claimant",
        "Vehicle: 2021 Toyota Camry, VIN 4T1B11HK5MU123456",
        "",
    ]
    lines += [f"{name:<45} ${amount:>10,.2f}" for name, amount in items]
    lines += ["", f"{'TOTAL':<45} ${total:>10,.2f}"]
    pdf(path, "Repair Invoice", lines)


def photo(path: Path, shot: str) -> None:
    img = Image.new("RGB", (800, 500), (200, 210, 220))
    d = ImageDraw.Draw(img)
    d.rectangle([100, 150, 700, 400], fill=(150, 20, 30))      # car body
    d.rectangle([100, 330, 700, 400], fill=(60, 60, 60))       # bumper
    d.polygon([(420, 330), (520, 300), (560, 380), (450, 400)], fill=(30, 30, 30))  # dent
    d.rectangle([110, 200, 170, 250], fill=(255, 140, 0))      # tail light
    d.line([(110, 200), (170, 250)], fill=(0, 0, 0), width=4)  # cracked
    d.text((20, 20), f"Rear of 2021 Toyota Camry - 2026-09-14 - {shot}", fill=(0, 0, 0))
    img.save(path)


for scenario in ("clean", "suspicious"):
    (HERE / scenario).mkdir(exist_ok=True)
    claim_form(HERE / scenario / "claim-form.pdf")
    photo(HERE / scenario / "rear-damage.png", "IMG_0412" if scenario == "clean" else "IMG_0977")

invoice(HERE / "clean" / "invoice.pdf", "Main Street Collision", "2026-09-16", [
    ("Rear bumper cover (OEM) + paint", 1850.00),
    ("Trunk lid repair and refinish", 1600.00),
    ("Left tail light assembly", 420.00),
    ("Labor 14h @ $70", 980.00),
])
invoice(HERE / "suspicious" / "invoice.pdf", "QuickFix Auto Body", "2026-09-02", [
    ("Rear bumper cover (OEM) + paint", 1850.00),
    ("Trunk lid replacement", 2600.00),
    ("Left tail light assembly", 420.00),
    ("Front windshield replacement", 500.00),
    ("Labor 14h @ $70", 980.00),
])
print("Samples written to", HERE)
