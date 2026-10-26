"""Object storage with time-bound signed URLs.

Key hierarchy preserved from ICME: {CustomerCode}/{OrgCode}/{Year}/{Cycle}/{Subject}/{Workspace}/...
LocalStorage -> disk + JWT-signed URLs. AzureBlobStorage -> Blob Storage + SAS tokens.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Protocol

import jwt

from ..config import get_settings


def build_key(customer: str, org: str, year: str | None, cycle: str | None, subject: str, workspace: str, filename: str) -> str:
    parts = [customer, org, year or "NA", cycle or "NA", subject, workspace, filename]
    return "/".join(_safe(p) for p in parts)


def _safe(part: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._\- ]", "_", part).strip().replace("..", "_")
    return cleaned or "_"


class Storage(Protocol):
    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str: ...
    def get(self, key: str) -> bytes: ...
    def signed_url(self, key: str) -> str: ...


class LocalStorage:
    def __init__(self) -> None:
        self.s = get_settings()
        self.root = Path(self.s.storage_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise ValueError("Invalid storage key")
        return p

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return key

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def resolve_path(self, key: str) -> Path:
        return self._path(key)

    def signed_url(self, key: str) -> str:
        exp = datetime.now(timezone.utc) + timedelta(minutes=self.s.signed_url_minutes)
        token = jwt.encode({"key": key, "typ": "file", "exp": exp}, self.s.jwt_secret, algorithm=self.s.jwt_algorithm)
        return f"{self.s.public_base_url}/files/{token}"

    def verify_token(self, token: str) -> str:
        data = jwt.decode(token, self.s.jwt_secret, algorithms=[self.s.jwt_algorithm])
        if data.get("typ") != "file":
            raise jwt.InvalidTokenError("wrong type")
        return data["key"]


class AzureBlobStorage:
    def __init__(self) -> None:
        from azure.storage.blob import BlobServiceClient

        self.s = get_settings()
        self.svc = BlobServiceClient.from_connection_string(self.s.azure_storage_connection_string)
        self.container = self.svc.get_container_client(self.s.azure_storage_container)
        if not self.container.exists():
            self.container.create_container()

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        from azure.storage.blob import ContentSettings

        self.container.upload_blob(key, data, overwrite=True, content_settings=ContentSettings(content_type=content_type))
        return key

    def get(self, key: str) -> bytes:
        return self.container.download_blob(key).readall()

    def signed_url(self, key: str) -> str:
        from azure.storage.blob import BlobSasPermissions, generate_blob_sas

        exp = datetime.now(timezone.utc) + timedelta(minutes=self.s.signed_url_minutes)
        sas = generate_blob_sas(
            account_name=self.svc.account_name,
            container_name=self.s.azure_storage_container,
            blob_name=key,
            account_key=self.svc.credential.account_key,
            permission=BlobSasPermissions(read=True),
            expiry=exp,
        )
        return f"{self.container.url}/{key}?{sas}"


@lru_cache
def get_storage() -> Storage:
    return AzureBlobStorage() if get_settings().storage_mode == "azure" else LocalStorage()
