"""
[DECOMMISSIONED / RETIRED]
Direct database seeding script decommissioned per Spec 0007.
All user accounts, roles, and administrative credentials are created and updated
exclusively through the authenticated user management endpoints (/api/v1/users)
and official Supabase administrative interfaces.
"""
import sys

if __name__ == "__main__":
    print("Notice: Direct database user seeding has been decommissioned.")
    print("All user management and administration must be performed through the authenticated application endpoints or Supabase console.")
    sys.exit(0)
