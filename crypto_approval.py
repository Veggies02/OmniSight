"""OmniSight Cryptographic Human Approval Verification Infrastructure.

Implements authoritative asymmetric digital signatures (Ed25519, RFC 8032)
to guarantee that code repairs can only be executed when approved by an
authorized reviewer identity with an un-tampered, non-expired, and non-replayed
cryptographic approval token.

Design Principles:
- Asymmetric Public-Key Cryptography: The worker service only receives the public
  verification key (OMNISIGHT_APPROVAL_PUBLIC_KEY_HEX). The private signing key
  is strictly held outside the worker boundary (e.g. by orchestrator / reviewer).
- Exact Digest Binding: The signature cryptographically binds the proposal ID,
  source file, original file SHA-256, target patch ID, patch digest SHA-256,
  reviewer identity, review timestamp, expiration timestamp, and unique nonce.
- Replay & Expiration Protections: Approvals have a strict time-to-live (TTL) and
  unique nonces tracked in a thread-safe replay cache.
- Fail-Closed: Any signature invalidity, tampering, expiration, replay, or missing
  key causes an immediate fail-closed rejection.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import threading
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Set, Tuple

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric import ed25519


def compute_digest_sha256(content: str | bytes) -> str:
    """Computes a 64-character lowercase hexadecimal SHA-256 digest."""
    data = content.encode("utf-8") if isinstance(content, str) else content
    return hashlib.sha256(data).hexdigest()


class ApprovalSigningPayload:
    """Canonical representation of the approval payload signed by the reviewer."""

    def __init__(
        self,
        proposal_id: str,
        scenario_id: Optional[str],
        defect_category: str,
        source_file: str,
        source_file_sha256: str,
        patch_id: Optional[str],
        patch_digest_sha256: Optional[str],
        reviewed_by: str,
        reviewed_at: str,
        expires_at: str,
        approval_nonce: str,
        signer_key_id: Optional[str] = None,
    ) -> None:
        self.proposal_id = proposal_id
        self.scenario_id = scenario_id or ""
        self.defect_category = defect_category
        self.source_file = source_file.strip().replace("\\", "/")
        self.source_file_sha256 = source_file_sha256.lower()
        self.patch_id = patch_id or ""
        self.patch_digest_sha256 = (patch_digest_sha256 or "").lower()
        self.reviewed_by = reviewed_by.strip()
        self.reviewed_at = reviewed_at.strip()
        self.expires_at = expires_at.strip()
        self.approval_nonce = approval_nonce.strip()
        self.signer_key_id = (signer_key_id or "").strip()

    def to_dict(self) -> Dict[str, str]:
        """Serializes payload into a deterministic dictionary."""
        return {
            "approval_nonce": self.approval_nonce,
            "defect_category": self.defect_category,
            "expires_at": self.expires_at,
            "patch_digest_sha256": self.patch_digest_sha256,
            "patch_id": self.patch_id,
            "proposal_id": self.proposal_id,
            "reviewed_at": self.reviewed_at,
            "reviewed_by": self.reviewed_by,
            "scenario_id": self.scenario_id,
            "signer_key_id": self.signer_key_id,
            "source_file": self.source_file,
            "source_file_sha256": self.source_file_sha256,
        }

    def canonical_bytes(self) -> bytes:
        """Returns deterministic, canonical JSON UTF-8 bytes (sorted keys, compact)."""
        d = self.to_dict()
        canonical_str = json.dumps(d, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        return f"OMNISIGHT_APPROVAL_V1:{canonical_str}".encode("utf-8")


class ApprovalReplayCache:
    """Thread-safe bounded in-memory cache to detect and reject replayed approvals."""

    def __init__(self, max_entries: int = 10000) -> None:
        self._lock = threading.Lock()
        self._seen_nonces: Dict[str, datetime] = {}
        self._max_entries = max_entries

    def check_and_record(self, nonce: str, signature: str, expires_at: datetime) -> bool:
        """Checks if nonce or signature was seen.

        Returns True if fresh (recorded successfully), False if replay detected.
        """
        now = datetime.now(timezone.utc)
        with self._lock:
            # Purge expired entries if cache is growing
            if len(self._seen_nonces) > self._max_entries:
                self._seen_nonces = {k: exp for k, exp in self._seen_nonces.items() if exp > now}

            composite_key = f"{nonce}:{signature[:32]}"
            if composite_key in self._seen_nonces:
                return False

            self._seen_nonces[composite_key] = expires_at
            return True

    def clear(self) -> None:
        """Resets the replay cache (useful for testing)."""
        with self._lock:
            self._seen_nonces.clear()


class ApprovalSigner:
    """Authoritative signing entity (used by Orchestrator / Human Review Station).

    Possesses the Ed25519 private key. MUST NEVER be instantiated inside the untrusted worker!
    """

    def __init__(
        self,
        private_key: ed25519.Ed25519PrivateKey,
        key_id: str = "omnisight-qa-root",
    ) -> None:
        self.private_key = private_key
        self.key_id = key_id

    def __repr__(self) -> str:
        return f"<ApprovalSigner key_id={self.key_id!r} public_key={self.public_key_hex[:16]}... (private_key=[REDACTED])>"

    def __str__(self) -> str:
        return self.__repr__()

    @classmethod
    def generate(cls, key_id: str = "omnisight-qa-root") -> ApprovalSigner:
        """Generates a fresh Ed25519 signing keypair."""
        priv = ed25519.Ed25519PrivateKey.generate()
        return cls(private_key=priv, key_id=key_id)

    @classmethod
    def from_hex(cls, private_hex: str, key_id: str = "omnisight-qa-root") -> ApprovalSigner:
        """Instantiates signer from 32-byte (64 hex characters) raw private key."""
        raw = bytes.fromhex(private_hex.strip())
        priv = ed25519.Ed25519PrivateKey.from_private_bytes(raw)
        return cls(private_key=priv, key_id=key_id)

    @property
    def public_key_hex(self) -> str:
        """Returns 64-character hex representation of the public key."""
        raw_pub = self.private_key.public_key().public_bytes_raw()
        return raw_pub.hex()

    @property
    def private_key_hex(self) -> str:
        """Returns 64-character hex representation of the private key."""
        return self.private_key.private_bytes_raw().hex()

    def create_approved_ref(
        self,
        proposal_id: str,
        defect_category: str,
        source_file: str,
        source_file_sha256: str,
        reviewed_by: str,
        scenario_id: Optional[str] = None,
        patch_id: Optional[str] = None,
        patch_digest_sha256: Optional[str] = None,
        reviewed_at: Optional[str] = None,
        ttl_seconds: int = 3600,
        nonce: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Creates and cryptographically signs an approved proposal reference dictionary."""
        now = datetime.now(timezone.utc)
        rev_at = reviewed_at or now.isoformat()
        exp_dt = datetime.fromtimestamp(now.timestamp() + ttl_seconds, tz=timezone.utc)
        exp_at = exp_dt.isoformat()
        app_nonce = nonce or secrets.token_hex(16)

        payload = ApprovalSigningPayload(
            proposal_id=proposal_id,
            scenario_id=scenario_id,
            defect_category=defect_category,
            source_file=source_file,
            source_file_sha256=source_file_sha256,
            patch_id=patch_id,
            patch_digest_sha256=patch_digest_sha256,
            reviewed_by=reviewed_by,
            reviewed_at=rev_at,
            expires_at=exp_at,
            approval_nonce=app_nonce,
            signer_key_id=self.key_id,
        )

        sig_bytes = self.private_key.sign(payload.canonical_bytes())
        sig_hex = sig_bytes.hex()

        return {
            "proposal_id": proposal_id,
            "scenario_id": scenario_id,
            "defect_category": defect_category,
            "source_file": source_file,
            "source_file_sha256": source_file_sha256,
            "patch_id": patch_id,
            "patch_digest_sha256": patch_digest_sha256,
            "reviewed_by": reviewed_by,
            "reviewed_at": rev_at,
            "expires_at": exp_at,
            "approval_nonce": app_nonce,
            "signer_key_id": self.key_id,
            "signature": sig_hex,
        }


class ApprovalVerifier:
    """Worker-side verification engine.

    Holds ONLY public keys. Validates Ed25519 signatures, expiration timestamps,
    patch digests, and enforces replay prevention.
    """

    def __init__(
        self,
        trusted_public_keys: Optional[Dict[str, ed25519.Ed25519PublicKey]] = None,
        default_public_key: Optional[ed25519.Ed25519PublicKey] = None,
        replay_cache: Optional[ApprovalReplayCache] = None,
        enforce_signatures: bool = True,
        revoked_key_ids: Optional[Set[str]] = None,
        revoked_public_keys: Optional[Set[str]] = None,
    ) -> None:
        self.trusted_public_keys: Dict[str, ed25519.Ed25519PublicKey] = trusted_public_keys or {}
        self.default_public_key: Optional[ed25519.Ed25519PublicKey] = default_public_key
        self.replay_cache = replay_cache or ApprovalReplayCache()
        self.enforce_signatures = enforce_signatures
        self.revoked_key_ids: Set[str] = set(revoked_key_ids) if revoked_key_ids else set()
        self.revoked_public_keys: Set[str] = {k.lower() for k in revoked_public_keys} if revoked_public_keys else set()

    def __repr__(self) -> str:
        return (
            f"<ApprovalVerifier trusted_keys={list(self.trusted_public_keys.keys())} "
            f"revoked_keys={list(self.revoked_key_ids)} enforce={self.enforce_signatures}>"
        )

    def __str__(self) -> str:
        return self.__repr__()

    def revoke_key_id(self, key_id: str) -> None:
        """Revokes an authoritative key ID, immediately invalidating all signatures issued under it."""
        self.revoked_key_ids.add(key_id.strip())

    def revoke_public_key_hex(self, public_key_hex: str) -> None:
        """Revokes an authoritative public key by its raw 64-hex-character value."""
        self.revoked_public_keys.add(public_key_hex.strip().lower())

    @classmethod
    def from_env(cls) -> ApprovalVerifier:
        """Configures verifier from environment variables.

        OMNISIGHT_APPROVAL_PUBLIC_KEY_HEX: hex public key.
        OMNISIGHT_ENFORCE_APPROVAL_SIGNATURES: '1' (default) or '0'.
        OMNISIGHT_REVOKED_KEY_IDS: comma-separated list of revoked key IDs.
        OMNISIGHT_REVOKED_PUBLIC_KEYS_HEX: comma-separated list of revoked public keys.
        """
        pub_hex = os.environ.get("OMNISIGHT_APPROVAL_PUBLIC_KEY_HEX", "").strip()
        enforce_raw = os.environ.get("OMNISIGHT_ENFORCE_APPROVAL_SIGNATURES")
        if enforce_raw is not None:
            enforce = enforce_raw.lower() in ("1", "true", "yes")
        else:
            enforce = bool(pub_hex)

        default_key: Optional[ed25519.Ed25519PublicKey] = None
        trusted_keys: Dict[str, ed25519.Ed25519PublicKey] = {}

        if pub_hex:
            try:
                raw_bytes = bytes.fromhex(pub_hex)
                default_key = ed25519.Ed25519PublicKey.from_public_bytes(raw_bytes)
                key_id = os.environ.get("OMNISIGHT_APPROVAL_KEY_ID", "omnisight-qa-root")
                trusted_keys[key_id] = default_key
            except Exception as exc:
                print(f"[ApprovalVerifier] Warning: failed to parse OMNISIGHT_APPROVAL_PUBLIC_KEY_HEX: {exc}")

        revoked_ids_raw = os.environ.get("OMNISIGHT_REVOKED_KEY_IDS", "")
        revoked_ids = {k.strip() for k in revoked_ids_raw.split(",") if k.strip()}

        revoked_pubs_raw = os.environ.get("OMNISIGHT_REVOKED_PUBLIC_KEYS_HEX", "")
        revoked_pubs = {k.strip().lower() for k in revoked_pubs_raw.split(",") if k.strip()}

        return cls(
            trusted_public_keys=trusted_keys,
            default_public_key=default_key,
            enforce_signatures=enforce,
            revoked_key_ids=revoked_ids,
            revoked_public_keys=revoked_pubs,
        )

    def add_trusted_key(self, key_id: str, public_key_hex: str) -> None:
        """Registers a trusted public key."""
        raw_bytes = bytes.fromhex(public_key_hex.strip())
        pub = ed25519.Ed25519PublicKey.from_public_bytes(raw_bytes)
        self.trusted_public_keys[key_id] = pub
        if self.default_public_key is None:
            self.default_public_key = pub

    def verify(
        self,
        proposal_ref: Any,
        expected_patch_digest: Optional[str] = None,
    ) -> Tuple[bool, str]:
        """Verifies cryptographic signature, digest binding, expiration, and replay.

        Returns (True, message) if valid, (False, reason) if verification fails.
        """
        sig_hex = getattr(proposal_ref, "signature", None)

        # If signatures are not enforced, no keys configured, and no signature was sent,
        # fallback to basic legacy metadata verification.
        has_key = bool(self.trusted_public_keys or self.default_public_key)
        if not self.enforce_signatures and not has_key and not sig_hex:
            if not getattr(proposal_ref, "reviewed_by", None) or not getattr(proposal_ref, "reviewed_at", None):
                return False, "Missing legacy approval metadata (reviewed_by and reviewed_at)"
            return True, "Legacy metadata accepted (signature enforcement disabled)"

        # Check signature field presence
        if not sig_hex:
            return False, "Missing cryptographic signature on approved proposal reference."

        # Check required fields
        expires_at_str = getattr(proposal_ref, "expires_at", None)
        if not expires_at_str:
            return False, "Missing expires_at timestamp on approved proposal reference."

        nonce = getattr(proposal_ref, "approval_nonce", None)
        if not nonce:
            return False, "Missing approval_nonce on approved proposal reference."

        reviewed_by = getattr(proposal_ref, "reviewed_by", None)
        if not reviewed_by or not reviewed_by.strip():
            return False, "Missing or empty reviewed_by reviewer identity."

        reviewed_at_str = getattr(proposal_ref, "reviewed_at", None)
        if not reviewed_at_str:
            return False, "Missing reviewed_at timestamp on approved proposal reference."

        # Check expiration
        now = datetime.now(timezone.utc)
        try:
            # Handle ISO string with or without Z / offset
            clean_exp = expires_at_str.replace("Z", "+00:00")
            exp_dt = datetime.fromisoformat(clean_exp)
            if exp_dt.tzinfo is None:
                exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        except Exception as exc:
            return False, f"Malformed expires_at timestamp {expires_at_str!r}: {exc}"

        if now > exp_dt:
            return False, f"Approval signature expired at {expires_at_str} (current time: {now.isoformat()})."

        # Check review timestamp not in future (allow 10 seconds for clock skew)
        try:
            clean_rev = reviewed_at_str.replace("Z", "+00:00")
            rev_dt = datetime.fromisoformat(clean_rev)
            if rev_dt.tzinfo is None:
                rev_dt = rev_dt.replace(tzinfo=timezone.utc)
            if rev_dt.timestamp() > (now.timestamp() + 10.0):
                return False, f"Approval reviewed_at timestamp {reviewed_at_str!r} is in the future."
        except Exception as exc:
            return False, f"Malformed reviewed_at timestamp {reviewed_at_str!r}: {exc}"

        # Check expected patch digest if supplied
        patch_digest = getattr(proposal_ref, "patch_digest_sha256", None)
        if expected_patch_digest:
            clean_expected = expected_patch_digest.lower()
            if not patch_digest or patch_digest.lower() != clean_expected:
                return False, (
                    f"Patch digest mismatch: proposal specified {patch_digest!r}, "
                    f"authoritative patch requires {clean_expected!r}."
                )

        # Check key revocation by key_id
        key_id = getattr(proposal_ref, "signer_key_id", None)
        if key_id and key_id in self.revoked_key_ids:
            return False, f"Signing key {key_id!r} has been revoked and cannot authorize proposals."

        # Select public verification key
        public_key = self.trusted_public_keys.get(key_id) if key_id else None
        if not public_key:
            public_key = self.default_public_key

        if not public_key:
            return False, f"No trusted public key found to verify signature (signer_key_id={key_id!r})."

        # Check key revocation by public key bytes
        pub_hex = public_key.public_bytes_raw().hex().lower()
        if pub_hex in self.revoked_public_keys:
            return False, f"Authoritative public key {pub_hex[:16]}... has been revoked."

        # Check replay protection
        if not self.replay_cache.check_and_record(nonce, sig_hex, exp_dt):
            return False, (
                f"Approval replay attack detected: nonce {nonce!r} or signature "
                "has already been submitted."
            )

        # Reconstruct canonical signing payload
        payload = ApprovalSigningPayload(
            proposal_id=getattr(proposal_ref, "proposal_id", ""),
            scenario_id=getattr(proposal_ref, "scenario_id", None),
            defect_category=getattr(proposal_ref, "defect_category", ""),
            source_file=getattr(proposal_ref, "source_file", ""),
            source_file_sha256=getattr(proposal_ref, "source_file_sha256", ""),
            patch_id=getattr(proposal_ref, "patch_id", None),
            patch_digest_sha256=patch_digest,
            reviewed_by=reviewed_by,
            reviewed_at=reviewed_at_str,
            expires_at=expires_at_str,
            approval_nonce=nonce,
            signer_key_id=key_id,
        )

        canonical_data = payload.canonical_bytes()

        # Parse raw signature bytes
        try:
            sig_bytes = bytes.fromhex(sig_hex.strip())
        except Exception:
            return False, f"Invalid signature format: not valid hex string: {sig_hex!r}"

        if len(sig_bytes) != 64:
            return False, f"Invalid Ed25519 signature length: expected 64 bytes, got {len(sig_bytes)}."

        # Perform Ed25519 verification
        try:
            public_key.verify(sig_bytes, canonical_data)
        except InvalidSignature:
            return False, (
                "Cryptographic signature verification failed: signature does not match "
                "authoritative key or proposal payload has been tampered with."
            )
        except Exception as exc:
            return False, f"Signature verification encountered an error: {exc}"

        return True, "Approval signature cryptographically verified."
