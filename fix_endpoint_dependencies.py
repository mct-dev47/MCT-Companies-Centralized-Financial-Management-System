import os
import re

files = [
    r'backend/app/api/v1/endpoints/sales.py',
    r'backend/app/api/v1/endpoints/expenses.py',
    r'backend/app/api/v1/endpoints/bills.py',
    r'backend/app/api/v1/endpoints/lending.py',
    r'backend/app/api/v1/endpoints/tenants.py',
    r'backend/app/api/v1/endpoints/petty_cash.py',
    r'backend/app/api/v1/endpoints/bank_accounts.py',
    r'backend/app/api/v1/endpoints/loans.py',
    r'backend/app/api/v1/endpoints/companies.py',
]

dep_map = {
    'Depends(BusinessReader)': 'Depends(require_business_reader)',
    'Depends(BusinessWriter)': 'Depends(require_business_writer)',
    'Depends(AuditorUser)': 'Depends(require_auditor_user)',
    'Depends(FinanceUser)': 'Depends(require_finance_user)',
    'Depends(AdminUser)': 'Depends(require_admin_user)',
    'Depends(CurrentUser)': 'Depends(get_current_user)',
}

symbols_to_add = {
    'require_business_reader',
    'require_business_writer',
    'require_finance_user',
    'require_auditor_user',
    'require_admin_user',
    'get_current_user',
}

for fpath in files:
    if not os.path.exists(fpath):
        continue
    with open(fpath, 'r', encoding='utf-8') as f:
        content = f.read()

    modified = False
    for old_dep, new_dep in dep_map.items():
        if old_dep in content:
            content = content.replace(old_dep, new_dep)
            modified = True

    # Ensure the require_* functions are imported from app.core.dependencies
    if modified:
        # Check dependencies import
        m = re.search(r'from app\.core\.dependencies import \((.*?)\)', content, re.DOTALL)
        if m:
            existing_imports = [x.strip() for x in m.group(1).split(',') if x.strip()]
            for sym in symbols_to_add:
                if sym in content and sym not in existing_imports:
                    existing_imports.append(sym)
            new_import_block = 'from app.core.dependencies import (\n    ' + ',\n    '.join(sorted(set(existing_imports))) + ',\n)'
            content = content[:m.start()] + new_import_block + content[m.end():]
        else:
            m2 = re.search(r'from app\.core\.dependencies import (.*)', content)
            if m2:
                line_imports = [x.strip() for x in m2.group(1).split(',') if x.strip()]
                for sym in symbols_to_add:
                    if sym in content and sym not in line_imports:
                        line_imports.append(sym)
                new_line = 'from app.core.dependencies import ' + ', '.join(sorted(set(line_imports)))
                content = content[:m2.start()] + new_line + content[m2.end():]

        with open(fpath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Updated {fpath}')

print('Finished updating endpoint dependencies')

