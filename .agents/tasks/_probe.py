import sys, warnings
sys.path.insert(0, r"c:\Users\Shelley\Desktop\projects\python\MCT-Companies-Centralized-Financial-Management-System\backend")
sys.dont_write_bytecode = True
warnings.filterwarnings("ignore")
from decimal import Decimal
from fastapi.testclient import TestClient
from app.main import app

c = TestClient(app)
out = open(r"c:\Users\Shelley\Desktop\projects\python\MCT-Companies-Centralized-Financial-Management-System\.agents\tasks\_probe_out.txt", "w", encoding="utf-8")
def P(*a):
    print(*a, file=out, flush=True)

def get(p):
    r = c.get(p)
    ct = r.headers.get("content-type", "")
    return r.status_code, (r.json() if ct.startswith("application/json") else r.text[:200])

res = {}
for p in ["/api/v1/companies", "/api/v1/sales", "/api/v1/expenses", "/api/v1/loans", "/api/v1/calculations/group-summary"]:
    try:
        s, j = get(p)
        res[p] = (s, j)
    except Exception as e:
        P(p, "EXC", type(e).__name__, str(e)[:300])
        continue
    if isinstance(j, list):
        P(p, s, "rows", len(j))
    elif isinstance(j, dict) and "company_summaries" in j:
        P(p, s, {k: v for k, v in j.items() if k != "company_summaries"}, "n_summaries", len(j["company_summaries"]))
    else:
        P(p, s, str(j)[:300])

C = res.get("/api/v1/companies")
if C and C[0] == 200:
    P("company ids", [(x["company_id"]) for x in C[1]])
S = res.get("/api/v1/sales"); E = res.get("/api/v1/expenses"); L = res.get("/api/v1/loans"); G = res.get("/api/v1/calculations/group-summary")
if S and S[0] == 200:
    P("sum sales", sum(Decimal(str(x["amount"])) for x in S[1]), "company ids", sorted({x["company_id"] for x in S[1]}))
if E and E[0] == 200:
    P("sum expenses", sum(Decimal(str(x["amount"])) for x in E[1]), "company ids", sorted({x["company_id"] for x in E[1]}))
if L and L[0] == 200:
    P("sum loan principal", sum(Decimal(str(x["principal_amount"])) for x in L[1]), "statuses", sorted({x["status"] for x in L[1]}), "parties", sorted({x["borrower"] for x in L[1]} | {x["lender"] for x in L[1]}))
if G and G[0] == 200:
    P("nonzero summaries", [(x["company_id"], x["total_revenue"], x["total_expenses"], x["total_loans_borrowed"], x["total_loans_lent"]) for x in G[1]["company_summaries"] if float(x["total_revenue"]) or float(x["total_expenses"]) or float(x["total_loans_borrowed"]) or float(x["total_loans_lent"])])
P("done")
