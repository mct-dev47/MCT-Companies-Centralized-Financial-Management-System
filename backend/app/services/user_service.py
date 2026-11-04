import hashlib
import logging
from pathlib import PurePosixPath
import secrets
import threading
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from uuid import uuid4

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.encryption import encrypt_payload
from app.db.supabase import get_supabase_admin_client
from app.models.company import Company
from app.models.invitation import InvitationOutbox, UserInvitation
from app.models.user import User, UserCompany
from app.schemas.user import UserCreate, UserResponse, UserUpdate

logger = logging.getLogger(__name__)


class UserServiceError(Exception):
    """Safe application error for user operations."""


class UserValidationError(ValueError):
    """Safe validation error for user business rules."""


class UserService:
    """Database profile operations and Supabase Auth coordination."""
    _user_picture_bucket = "user profiles"

    ALLOWED_ROLES = {"finance", "audit", "auditor", "supervisor"}

    def __init__(self, db: Session):
        self.db = db

    @staticmethod
    def is_protected_admin(user: User) -> bool:
        """Check if user is the protected primary Admin account."""
        if not user:
            return False
        return bool(user.user_id == 1 or user.is_admin or (user.role and user.role.strip().lower() == "admin"))

    def _extract_storage_path(self, photo_url: Optional[str]) -> Optional[str]:
        if not photo_url:
            return None
        clean = photo_url.split("?")[0]
        for token in ("user%20profiles/", "user profiles/"):
            if token in clean:
                return clean.split(token, 1)[-1].strip("/")
        if clean.startswith("user/"):
            return clean.strip("/")
        return None

    def _sign_url(self, storage_path: str) -> Optional[str]:
        if not storage_path:
            return None
        try:
            storage = get_supabase_admin_client().storage.from_(self._user_picture_bucket)
            signed = storage.create_signed_url(storage_path, 604800)  # 7 days
            if isinstance(signed, dict):
                return signed.get("signedURL") or signed.get("signedUrl")
            return str(signed)
        except Exception as e:
            logger.warning("Could not generate signed URL for %s: %s", storage_path, e)
            return None



    # get all users, optionally filtered by company_id
    def list_users(self, company_id: int | None = None) -> List[UserResponse]:
        try:
            query = self.db.query(User)
            if company_id is not None:
                query = query.filter(
                    (User.company_id == company_id) |
                    (User.user_id.in_(
                        self.db.query(UserCompany.user_id).filter(UserCompany.company_id == company_id)
                    ))
                )
            users = query.order_by(User.user_id.asc()).all()

            # Batch sign URLs for user profiles
            path_map = {}
            paths_to_sign = []
            for u in users:
                if u.photo_url:
                    p = self._extract_storage_path(u.photo_url)
                    if p:
                        paths_to_sign.append(p)
                        path_map[u.user_id] = p

            signed_urls = {}
            if paths_to_sign:
                try:
                    storage = get_supabase_admin_client().storage.from_(self._user_picture_bucket)
                    batch_res = storage.create_signed_urls(paths_to_sign, 604800)
                    if isinstance(batch_res, list):
                        for item in batch_res:
                            if isinstance(item, dict) and item.get("path"):
                                s_url = item.get("signedURL") or item.get("signedUrl")
                                if s_url:
                                    signed_urls[item["path"]] = s_url
                except Exception as e:
                    logger.warning("Batch signed URL generation failed: %s", e)

            return [
                self.to_response(u, signed_url=signed_urls.get(path_map.get(u.user_id)))
                for u in users
            ]
        except SQLAlchemyError as error:
            raise self._database_error("list users", error)

    # get a single user by ID
    def get_user(self, user_id: int) -> Optional[User]:
        try:
            return self.db.query(User).filter(User.user_id == user_id).first()
        except SQLAlchemyError as error:
            raise self._database_error("get user", error)

    # get a single user by ID and return a UserResponse
    def get_user_response(self, user_id: int) -> Optional[UserResponse]:
        user = self.get_user(user_id)
        return self.to_response(user) if user else None

    # create a new user and return a UserResponse
    def create_user(self, user_in: UserCreate) -> UserResponse:
        raw_role = (user_in.role or "supervisor").strip().lower()
        if raw_role in ("company", "company employee", "company_employee"):
            raw_role = "supervisor"

        if raw_role == "admin" or user_in.is_admin:
            raise UserValidationError("Cannot create additional Admin accounts. The system allows only one primary administrator.")

        if raw_role not in self.ALLOWED_ROLES:
            raise UserValidationError(f"Invalid role '{user_in.role}'. Allowed roles: Finance, Audit, Supervisor.")

        user_role = raw_role

        # Consolidate company IDs
        company_ids = []
        seen = set()
        for cid in list(user_in.company_ids) + ([user_in.company_id] if user_in.company_id else []):
            if cid and cid not in seen:
                seen.add(cid)
                company_ids.append(cid)

        # Also resolve from company_names or company_name
        c_names = list(getattr(user_in, "company_names", []) or [])
        if getattr(user_in, "company_name", None) and user_in.company_name not in c_names:
            c_names.append(user_in.company_name)

        if c_names:
            try:
                from app.core.company_resolver import resolve_company
                for cname in c_names:
                    resolved = resolve_company(self.db, company_name=cname)
                    if resolved and resolved.company_id and resolved.company_id not in seen:
                        seen.add(resolved.company_id)
                        company_ids.append(resolved.company_id)
            except Exception:
                pass

        self._validate_user_assignment(company_ids, False, user_role)
        self._ensure_email_available(user_in.email)
        primary_company_id = company_ids[0] if company_ids else user_in.company_id
        auth_user_id = self._create_auth_user(
            user_in,
            user_in.email,
            company_id=primary_company_id,
            company_ids=company_ids,
            role=user_role,
        )

        user = User(
            name=user_in.name.strip(),
            email=user_in.email,
            company_id=primary_company_id,
            is_admin=False,
            role="audit" if user_role == "auditor" else user_role,
            photo_url=user_in.photo_url,
            status="PROVISIONED",
            must_change_password=True,
        )
        try:
            self.db.add(user)
            self.db.commit()
            self.db.refresh(user)

            # Insert into user_companies
            for cid in company_ids:
                self.db.add(UserCompany(user_id=user.user_id, company_id=cid))

            # Generate Single-Use Setup Token
            raw_token = secrets.token_urlsafe(32)
            token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
            now = datetime.now(timezone.utc)
            invitation = UserInvitation(
                user_id=user.user_id,
                token_hash=token_hash,
                status="PENDING",
                expires_at=now + timedelta(hours=24),
            )
            self.db.add(invitation)
            self.db.flush()

            # Enqueue to Outbox with encrypted payload
            from app.core.config import settings
            from app.core.encryption import encrypt_invitation_token
            frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
            encrypted_token = encrypt_invitation_token(raw_token, user.user_id)
            setup_url = f"{frontend_url}/auth/setup-password#token={encrypted_token}"
            encrypted_payload = encrypt_payload({
                "user_id": user.user_id,
                "user_name": user.name,
                "setup_url": setup_url,
                "raw_token": raw_token,
            })
            outbox_entry = InvitationOutbox(
                idempotency_key=f"invite:{user.user_id}:{invitation.invitation_id}",
                user_id=user.user_id,
                invitation_id=invitation.invitation_id,
                recipient_email=user.email,
                encrypted_payload=encrypted_payload,
                status="PENDING",
            )
            self.db.add(outbox_entry)
            self.db.commit()
            self.db.refresh(user)

            # Trigger async outbox dispatch pass
            try:
                from app.services.invitation_dispatcher import process_pending_outbox_batch
                threading.Thread(target=process_pending_outbox_batch, daemon=True).start()
            except Exception as e:
                logger.warning("Could not trigger background outbox dispatcher: %s", e)

            return self.to_response(user)
        except IntegrityError as error:
            self.db.rollback()
            self._delete_auth_user(auth_user_id)
            raise UserValidationError("A user with this email already exists.") from error
        except SQLAlchemyError as error:
            self.db.rollback()
            self._delete_auth_user(auth_user_id)
            raise self._database_error("create user", error)

    def reinvite_user(self, user_id: int) -> UserResponse:
        user = self.get_user(user_id)
        if not user:
            raise UserValidationError("The user was not found.")

        if self.is_protected_admin(user):
            raise UserValidationError("Cannot re-invite the primary administrator.")

        if user.status == "ACTIVE":
            raise UserValidationError("User account is already active and cannot be re-invited.")

        # Revoke old pending or claimed invitations
        self.db.query(UserInvitation).filter(
            UserInvitation.user_id == user_id,
            UserInvitation.status.in_(["PENDING", "CLAIMED"]),
        ).update({"status": "REVOKED"}, synchronize_session=False)

        # Cancel pending outbox jobs
        self.db.query(InvitationOutbox).filter(
            InvitationOutbox.user_id == user_id,
            InvitationOutbox.status.in_(["PENDING", "FAILED"]),
        ).update({"status": "CANCELLED", "encrypted_payload": None}, synchronize_session=False)

        # Generate fresh single-use token
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        now = datetime.now(timezone.utc)
        invitation = UserInvitation(
            user_id=user.user_id,
            token_hash=token_hash,
            status="PENDING",
            expires_at=now + timedelta(hours=24),
        )
        self.db.add(invitation)
        self.db.flush()

        from app.core.config import settings
        from app.core.encryption import encrypt_invitation_token
        frontend_url = getattr(settings, "FRONTEND_URL", "http://localhost:5173").rstrip("/")
        encrypted_token = encrypt_invitation_token(raw_token, user.user_id)
        setup_url = f"{frontend_url}/auth/setup-password#token={encrypted_token}"
        encrypted_payload = encrypt_payload({
            "user_id": user.user_id,
            "user_name": user.name,
            "setup_url": setup_url,
            "raw_token": raw_token,
        })
        outbox_entry = InvitationOutbox(
            idempotency_key=f"invite:{user.user_id}:{invitation.invitation_id}",
            user_id=user.user_id,
            invitation_id=invitation.invitation_id,
            recipient_email=user.email,
            encrypted_payload=encrypted_payload,
            status="PENDING",
        )
        self.db.add(outbox_entry)
        self.db.commit()
        self.db.refresh(user)

        try:
            from app.services.invitation_dispatcher import process_pending_outbox_batch
            threading.Thread(target=process_pending_outbox_batch, daemon=True).start()
        except Exception as e:
            logger.warning("Could not trigger background outbox dispatcher: %s", e)

        return self.to_response(user)

    # update an existing user and return a UserResponse, or None if not found
    def update_user(
        self,
        user_id: int,
        user_in: UserUpdate,
    ) -> Optional[UserResponse]:
        user = self.get_user(user_id)
        if not user:
            return None

        if self.is_protected_admin(user):
            raise UserValidationError("The primary administrator account is protected and cannot be modified.")

        update_data = user_in.model_dump(exclude_unset=True)

        if "role" in update_data:
            role_val = str(update_data["role"]).strip().lower()
            if role_val in ("company", "company employee", "company_employee"):
                role_val = "supervisor"
            if role_val == "admin":
                raise UserValidationError("Cannot assign the Admin role. The system allows only one primary administrator.")
            if role_val not in self.ALLOWED_ROLES:
                raise UserValidationError(f"Invalid role '{update_data['role']}'. Allowed roles: Finance, Audit, Supervisor.")
            update_data["role"] = role_val

        if update_data.get("is_admin") is True:
            raise UserValidationError("Cannot grant Administrator privileges. The system allows only one primary administrator.")



        company_ids = update_data.pop("company_ids", None)
        if company_ids is not None:
            seen = set()
            deduped_cids = []
            for cid in company_ids:
                if cid and cid not in seen:
                    seen.add(cid)
                    deduped_cids.append(cid)
            company_ids = deduped_cids
            self._validate_user_assignment(company_ids, update_data.get("is_admin", user.is_admin), update_data.get("role", user.role))
            # Delete old user_companies and re-insert
            self.db.query(UserCompany).filter(UserCompany.user_id == user_id).delete()
            for cid in company_ids:
                self.db.add(UserCompany(user_id=user_id, company_id=cid))
            user.company_id = company_ids[0] if company_ids else None
        elif "company_id" in update_data:
            cid = update_data["company_id"]
            if cid:
                self._ensure_company_exists(cid)
                exists = self.db.query(UserCompany).filter(
                    UserCompany.user_id == user_id,
                    UserCompany.company_id == cid
                ).first()
                if not exists:
                    self.db.add(UserCompany(user_id=user_id, company_id=cid))

        auth_changes = {}
        if "email" in update_data:
            self._ensure_email_available(update_data["email"], excluding_user_id=user_id)
            auth_changes["email"] = update_data["email"]
        if "name" in update_data:
            update_data["name"] = update_data["name"].strip()
            auth_changes["user_metadata"] = {"name": update_data["name"]}
        if "password" in update_data:
            auth_changes["password"] = update_data.pop("password")
        if auth_changes:
            self._update_auth_user(user.email, auth_changes)

        try:
            for field, value in update_data.items():
                setattr(user, field, value)
            self.db.commit()
            self.db.refresh(user)

            return self.to_response(user)
        except IntegrityError as error:
            self.db.rollback()
            raise UserValidationError("A user with this email already exists.") from error
        except SQLAlchemyError as error:
            raise self._database_error("update user", error)

    # delete a user by ID and return True if deleted, False if not found
    def delete_user(self, user_id: int) -> bool:
        user = self.get_user(user_id)
        if not user:
            return False

        if self.is_protected_admin(user):
            raise UserValidationError("The primary administrator account is protected and cannot be deleted.")

        auth_user_id = None
        try:
            auth_user_id = self._find_auth_user_id(user.email)
        except Exception:
            pass

        # Cleanup photo in storage if present
        if user.photo_url and ("user%20profiles" in user.photo_url or "user profiles" in user.photo_url):
            self._remove_picture_by_url(user.photo_url)

        try:
            if auth_user_id:
                try:
                    self._delete_auth_user(auth_user_id)
                except Exception as e:
                    logger.warning("Could not delete Supabase auth user: %s", e)
            self.db.delete(user)
            self.db.commit()
            return True
        except SQLAlchemyError as error:
            raise self._database_error("delete user", error)

    def upload_user_picture(
        self,
        user_id: int,
        picture: bytes,
        content_type: str,
        filename: str,
    ) -> Optional[UserResponse]:
        user = self.get_user(user_id)
        if not user:
            return None

        if self.is_protected_admin(user):
            raise UserValidationError("The primary administrator account is protected and cannot be modified.")

        storage_path = ""
        try:
            extension = PurePosixPath(filename).suffix.lower()
            if not extension:
                extension = ".png"
            storage_path = f"user/{user.user_id}/{uuid4().hex}{extension}"
            storage = get_supabase_admin_client().storage.from_(self._user_picture_bucket)
            storage.upload(
                storage_path,
                picture,
                {"content-type": content_type, "upsert": "false"},
            )
            user.photo_url = storage_path
            self.db.commit()
            self.db.refresh(user)
            signed_url = self._sign_url(storage_path)
            return self.to_response(user, signed_url=signed_url)
        except SQLAlchemyError as error:
            self.db.rollback()
            if storage_path:
                self._remove_picture(storage_path)
            raise self._database_error("upload user picture", error)
        except Exception as error:
            self.db.rollback()
            if storage_path:
                self._remove_picture(storage_path)
            logger.exception("User picture upload failed (%s)", type(error).__name__)
            raise UserServiceError("The user profile picture could not be uploaded.") from error

    # convert a User model instance to a UserResponse schema instance
    def to_response(self, user: User, signed_url: Optional[str] = None) -> UserResponse:
        try:
            # Query user_companies
            user_company_rows = self.db.query(UserCompany).filter(UserCompany.user_id == user.user_id).all()
            assigned_cids = [uc.company_id for uc in user_company_rows]
            if not assigned_cids and user.company_id is not None:
                assigned_cids = [user.company_id]

            company_names: list[str] = []
            if assigned_cids:
                companies = self.db.query(Company).filter(Company.company_id.in_(assigned_cids)).all()
                comp_map = {c.company_id: c.company_name for c in companies}
                company_names = [comp_map[cid] for cid in assigned_cids if cid in comp_map]

            company_name = company_names[0] if company_names else None
            user_role = str(getattr(user, "role", "admin" if user.is_admin else "supervisor") or ("admin" if user.is_admin else "supervisor")).lower()
            if user_role in ("company", "company employee"):
                user_role = "supervisor"

            # Resolve signed photo URL
            photo_url = signed_url
            if not photo_url and user.photo_url:
                path = self._extract_storage_path(user.photo_url)
                if path:
                    photo_url = self._sign_url(path)
                else:
                    photo_url = user.photo_url

            return UserResponse(
                user_id=user.user_id,
                name=user.name,
                email=user.email,
                company_id=user.company_id,
                company_ids=assigned_cids,
                is_admin=user.is_admin,
                role=user_role,
                status=getattr(user, "status", "ACTIVE") or "ACTIVE",
                must_change_password=bool(getattr(user, "must_change_password", False)),
                photo_url=photo_url,
                last_login_at=user.last_login_at,
                created_at=user.created_at,
                updated_at=user.updated_at,
                company_name=company_name,
                company_names=company_names,
                is_protected=self.is_protected_admin(user),
            )
        except SQLAlchemyError as error:
            raise self._database_error("build user response", error)

    def _ensure_company_exists(self, company_id: int | None) -> None:
        if company_id is None:
            return
        try:
            exists = self.db.query(Company.company_id).filter(
                Company.company_id == company_id
            ).first()
        except SQLAlchemyError as error:
            raise self._database_error("validate user company", error)
        if exists is None:
            raise UserValidationError(f"The company with ID {company_id} does not exist.")

    def _ensure_email_available(
        self,
        email: str,
        excluding_user_id: int | None = None,
    ) -> None:
        try:
            query = self.db.query(User).filter(User.email == email)
            if excluding_user_id is not None:
                query = query.filter(User.user_id != excluding_user_id)
            if query.first() is not None:
                raise UserValidationError("A user with this email already exists.")
        except SQLAlchemyError as error:
            raise self._database_error("validate user email", error)

    def _validate_user_assignment(self, company_ids: list[int], is_admin: bool, role: str = "company") -> None:
        for cid in company_ids:
            self._ensure_company_exists(cid)

    @staticmethod
    def _create_auth_user(
        user_in: UserCreate,
        email: str,
        company_id: Optional[int] = None,
        company_ids: Optional[list[int]] = None,
        role: str = "supervisor",
    ) -> str:
        try:
            cids = company_ids or ([company_id] if company_id else [])
            user_meta = {"name": user_in.name.strip()}
            if company_id is not None:
                user_meta["company_id"] = company_id
            if cids:
                user_meta["company_ids"] = cids
            if role:
                user_meta["role"] = role

            app_meta = {"is_admin": False}
            if company_id is not None:
                app_meta["company_id"] = company_id
            if cids:
                app_meta["company_ids"] = cids
            if role:
                app_meta["role"] = role

            internal_seed = secrets.token_urlsafe(32)
            response = get_supabase_admin_client().auth.admin.create_user({
                "email": email,
                "password": internal_seed,
                "email_confirm": False,
                "user_metadata": user_meta,
                "app_metadata": app_meta,
            })
            auth_user = getattr(response, "user", response)
            auth_user_id = getattr(auth_user, "id", None)
            if not auth_user_id:
                raise UserServiceError("The user could not be created in authentication.")
            return str(auth_user_id)
        except UserServiceError:
            raise
        except Exception as error:
            logger.exception("Supabase Auth user creation failed (%s)", type(error).__name__)
            # Fallback if already in Supabase Auth
            err_str = (str(error) + " " + str(getattr(error, "message", "")) + " " + str(getattr(error, "code", ""))).lower()
            if "registered" in err_str or "already exists" in err_str or "email_exists" in err_str:
                try:
                    uid = UserService._find_auth_user_id(email)
                    UserService._update_auth_user(email, {
                        "user_metadata": user_meta,
                        "app_metadata": app_meta,
                    })
                    return uid
                except Exception:
                    pass
            raise UserValidationError(
                "The user could not be created in authentication."
            ) from error

    @classmethod
    def _find_auth_user_id(cls, email: str) -> str:
        try:
            response = get_supabase_admin_client().auth.admin.list_users()
            auth_users = getattr(response, "users", response)
            for auth_user in auth_users:
                if str(getattr(auth_user, "email", "")).lower() == email.lower():
                    return str(auth_user.id)
        except Exception as error:
            logger.exception("Supabase Auth user lookup failed (%s)", type(error).__name__)
            raise UserServiceError("The user operation could not be completed.") from error
        raise UserValidationError("The authentication user was not found.")

    @classmethod
    def _update_auth_user(cls, email: str, changes: dict[str, object]) -> None:
        auth_user_id = cls._find_auth_user_id(email)
        try:
            get_supabase_admin_client().auth.admin.update_user_by_id(
                auth_user_id,
                changes,
            )
        except Exception as error:
            logger.exception("Supabase Auth user update failed (%s)", type(error).__name__)
            raise UserServiceError("The user authentication could not be updated.") from error

    @staticmethod
    def _delete_auth_user(auth_user_id: str) -> None:
        try:
            get_supabase_admin_client().auth.admin.delete_user(auth_user_id)
        except Exception as error:
            logger.exception("Supabase Auth user deletion failed (%s)", type(error).__name__)
            raise UserServiceError("The user operation could not be completed.") from error

    def _remove_picture(self, storage_path: str) -> None:
        try:
            get_supabase_admin_client().storage.from_(
                self._user_picture_bucket
            ).remove([storage_path])
        except Exception:
            logger.exception("Could not clean up user picture: %s", storage_path)

    def _remove_picture_by_url(self, photo_url: str) -> None:
        try:
            bucket_token = "user%20profiles/" if "user%20profiles/" in photo_url else "user profiles/"
            if bucket_token in photo_url:
                storage_path = photo_url.split(bucket_token)[-1]
                self._remove_picture(storage_path)
        except Exception:
            logger.exception("Could not clean up user picture by url: %s", photo_url)

    def _database_error(self, operation: str, error: SQLAlchemyError) -> UserServiceError:
        self.db.rollback()
        logger.exception(
            "User database operation failed: %s (%s)",
            operation,
            type(error).__name__,
        )
        return UserServiceError("The user operation could not be completed.")
