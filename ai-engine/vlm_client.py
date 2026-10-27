"""VLM client: a thin, replaceable wrapper around vision-language models.

Supports:
- Abstract VisionModel base interface
- Deterministic MockVisionModel for offline development and testing
- GeminiVisionModel for real Google Gemini API vision inference
- OpenAIVisionModel for OpenAI-compatible vision models
- Configurable timeouts, bounded retries with exponential backoff, and strict credential safety.
"""
from abc import ABC, abstractmethod
import base64
import json
import mimetypes
import os
import re
import time
from typing import Any, Callable, Dict, Optional
import urllib.error
import urllib.request
from dotenv import load_dotenv

# Load environment variables if present
load_dotenv()


# =====================================================================
# Exception Hierarchy
# =====================================================================

class VLMError(Exception):
    """Base exception for all VLM-related failures."""
    pass


class VLMConfigurationError(VLMError):
    """Raised when provider configuration or credentials are missing/invalid."""
    pass


class VLMAuthenticationError(VLMError):
    """Raised when the VLM provider returns 401 or 403."""
    pass


class VLMRateLimitError(VLMError):
    """Raised when the VLM provider returns 429 Too Many Requests."""
    pass


class VLMTimeoutError(VLMError):
    """Raised when a request exceeds the configured timeout."""
    pass


class VLMNetworkError(VLMError):
    """Raised on connection drops, DNS issues, or unreachable hosts."""
    pass


# =====================================================================
# Helper Utilities
# =====================================================================

def sanitize_error_message(message: str) -> str:
    """Strip query params and potential API key tokens from error strings."""
    # Remove ?key=... or &key=...
    sanitized = re.sub(r'([?&]key=)[^&\s]+', r'\1[REDACTED]', message)
    # Remove Bearer tokens
    sanitized = re.sub(r'(Bearer\s+)[A-Za-z0-9_\-\.]+', r'\1[REDACTED]', sanitized)
    return sanitized


def execute_with_retry(
    operation: Callable[[], str],
    max_retries: int = 3,
    initial_delay: float = 1.0,
    backoff_factor: float = 2.0
) -> str:
    """Execute an operation with bounded retries on retryable transient errors."""
    delay = initial_delay
    last_exception = None

    for attempt in range(max_retries + 1):
        try:
            return operation()
        except (VLMRateLimitError, VLMTimeoutError, VLMNetworkError) as err:
            last_exception = err
            if attempt == max_retries:
                break
            time.sleep(delay)
            delay *= backoff_factor
        except Exception as err:
            # Non-retryable errors (e.g. Auth, Invalid Config, Image Missing) fail immediately
            raise err

    raise last_exception if last_exception else VLMError("Exceeded maximum retries")


# =====================================================================
# Base Interface
# =====================================================================

class VisionModel(ABC):
    """Interface every vision provider implements."""

    provider_name: str = "unknown"
    is_mock: bool = False

    @abstractmethod
    def analyze(self, image_path: str, prompt: str) -> str:
        """Send one image plus a prompt; return the raw model text."""
        raise NotImplementedError


# =====================================================================
# Mock Provider (Offline / Deterministic Testing)
# =====================================================================

class MockVisionModel(VisionModel):
    provider_name = "mock"
    is_mock = True
    """Deterministic mock provider for offline development and fast CI testing.
    
    Can return default synthetic findings, custom configured responses, or simulated errors.
    """

    DEFAULT_RESPONSE = json.dumps({
        "has_defect": True,
        "findings": [
            {
                "defect_category": "mobile_button_clipping",
                "description": "The primary 'Add to Cart' action button is clipped by the viewport border.",
                "confidence": 0.94,
                "target_selector": "button.btn-add-to-cart",
                "target_component": "ProductCard.tsx",
                "requires_human_review": False,
                "suggested_next_step": "Adjust flex container padding and min-width."
            }
        ]
    })

    def __init__(
        self,
        canned_response: Optional[str] = None,
        simulate_error: Optional[Exception] = None
    ):
        self.canned_response = canned_response or self.DEFAULT_RESPONSE
        self.simulate_error = simulate_error
        self.call_count = 0
        self.last_image_path: Optional[str] = None
        self.last_prompt: Optional[str] = None

    def analyze(self, image_path: str, prompt: str) -> str:
        """Simulate analysis, verifying file existence first."""
        self.call_count += 1
        self.last_image_path = image_path
        self.last_prompt = prompt

        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Screenshot not found at path: {image_path}")

        if self.simulate_error:
            raise self.simulate_error

        return self.canned_response


# =====================================================================
# Gemini VLM Provider
# =====================================================================

class GeminiVisionModel(VisionModel):
    provider_name = "gemini"
    is_mock = False
    """Concrete adapter for Google Gemini multimodal models."""

    DEFAULT_MODEL = "gemini-2.0-flash"

    def __init__(
        self,
        api_key: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
        max_retries: int = 3
    ):
        self.api_key = api_key or os.getenv("VLM_API_KEY", "")
        if not self.api_key:
            raise VLMConfigurationError(
                "Gemini API key is required. Set VLM_API_KEY environment variable or pass api_key."
            )

        self.model_name = model_name or os.getenv("VLM_MODEL", self.DEFAULT_MODEL)
        self.timeout_seconds = int(
            timeout_seconds or os.getenv("VLM_TIMEOUT_SECONDS", "60")
        )
        self.max_retries = max_retries

    def analyze(self, image_path: str, prompt: str) -> str:
        """Analyze image with Gemini via REST API."""
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Screenshot not found at path: {image_path}")

        mime_type, _ = mimetypes.guess_type(image_path)
        if not mime_type:
            mime_type = "image/png"

        with open(image_path, "rb") as img_file:
            encoded_image = base64.b64encode(img_file.read()).decode("utf-8")

        payload = {
            "contents": [
                {
                    "parts": [
                        {"text": prompt},
                        {
                            "inline_data": {
                                "mime_type": mime_type,
                                "data": encoded_image
                            }
                        }
                    ]
                }
            ],
            "generationConfig": {
                "temperature": 0.1,
                "response_mime_type": "application/json"
            }
        }

        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model_name}:generateContent?key={self.api_key}"
        data = json.dumps(payload).encode("utf-8")
        headers = {"Content-Type": "application/json"}

        def _perform_request() -> str:
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                    res_body = json.loads(response.read().decode("utf-8"))
                    candidates = res_body.get("candidates", [])
                    if not candidates:
                        raise VLMError("Gemini returned empty response candidates")
                    content_parts = candidates[0].get("content", {}).get("parts", [])
                    if not content_parts:
                        raise VLMError("Gemini returned candidate without parts")
                    return content_parts[0].get("text", "")
            except urllib.error.HTTPError as http_err:
                code = http_err.code
                err_msg = sanitize_error_message(f"Gemini API HTTP {code}: {http_err.reason}")
                if code in (401, 403):
                    raise VLMAuthenticationError(err_msg) from http_err
                if code == 429:
                    raise VLMRateLimitError(err_msg) from http_err
                if code in (500, 502, 503, 504):
                    raise VLMNetworkError(err_msg) from http_err
                raise VLMError(err_msg) from http_err
            except (urllib.error.URLError, TimeoutError, OSError) as net_err:
                sanitized_msg = sanitize_error_message(str(net_err))
                if "timed out" in sanitized_msg.lower():
                    raise VLMTimeoutError(f"Request to Gemini timed out: {sanitized_msg}") from net_err
                raise VLMNetworkError(f"Network error connecting to Gemini: {sanitized_msg}") from net_err

        return execute_with_retry(_perform_request, max_retries=self.max_retries)


# =====================================================================
# Factory Function
# =====================================================================

def get_vision_client(
    provider: Optional[str] = None,
    api_key: Optional[str] = None,
    model: Optional[str] = None,
    timeout: Optional[int] = None
) -> VisionModel:
    """Factory to create a configured vision model client.
    
    Defaults to 'mock' if no provider or API key is set, ensuring offline safety.
    """
    selected_provider = (provider or os.getenv("VLM_PROVIDER", "")).strip().lower()

    if selected_provider in ("mock", "test", ""):
        return MockVisionModel()

    if selected_provider == "gemini":
        return GeminiVisionModel(
            api_key=api_key,
            model_name=model,
            timeout_seconds=timeout
        )

    raise VLMConfigurationError(
        f"Unsupported VLM provider: '{selected_provider}'. Supported: 'mock', 'gemini'."
    )