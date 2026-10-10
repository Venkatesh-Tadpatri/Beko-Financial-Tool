"""Build small sample files for trying the upload wizard.

    backend\\.venv\\Scripts\\python.exe docs\\samples\\make_samples.py

sample-sales-sap.xlsx deliberately contains one unmapped customer code, one
negative value and one exact duplicate, so every kind of check can be seen.
"""

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font

OUT = Path(__file__).resolve().parent


def sales() -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Billing Export"
    ws.append(["Billing document list (SAP VF05 export)"])
    ws.append([])
    ws.append(["Billing Date", "Billing Doc.", "Sold-To Party", "Material", "Billed Quantity", "Net Value", "Currency"])
    ws["A1"].font = Font(bold=True)
    rows = [
        ("03.04.2025", 90001001, "C100", "M-AC15", 40, "18,40,000.00"),
        ("11.04.2025", 90001002, "C200", "M-FR300", 25, "6,87,500.00"),
        ("19.04.2025", 90001003, "C100", "M-FR300", 10, "2,75,000.00"),
        ("19.04.2025", 90001003, "C100", "M-FR300", 10, "2,75,000.00"),  # exact duplicate -> excluded
        ("06.05.2025", 90001011, "C100", "M-AC15", 55, "25,30,000.00"),
        ("14.05.2025", 90001012, "C300", "M-AC15", 5, "2,30,000.00"),  # C300 not mapped -> error
        ("22.05.2025", 90001013, "C200", "M-FR300", -2, "-55,000.00"),  # credit note -> warning
        ("02.06.2025", 90001021, "C200", "M-AC15", 30, "13,80,000.00"),
        ("16.06.2025", 90001022, "C100", "M-FR300", 35, "9,62,500.00"),
    ]
    for d, doc, cust, mat, qty, value in rows:
        ws.append([d, doc, cust, mat, qty, value, "INR"])
    wb.save(OUT / "sample-sales-sap.xlsx")


if __name__ == "__main__":
    sales()
    print("written to", OUT)
