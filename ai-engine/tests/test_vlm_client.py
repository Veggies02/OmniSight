"""Unit tests for VLM client adapters, mock provider, retries, and error handling."""
import json
import os
import tempfile
import pytest
from vlm_client import (
    VisionModel,
    MockVisionModel,
    GeminiVisionModel,
    get_vision_client,
    VLMConfigurationError,
    VLMAuthenticationError,
    VLMRateLimitError,
    VLMTimeoutError,
    VLMNetworkError,
    VLMError,
    sanitize_error_message,
    execute_with_retry
)


@pytest.fixture
def dummy_image():
    """Create a temporary dummy image file for testing."""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
        f.write(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15c4")
        temp_path = f.name
    yield temp_path
    if os.path.exists(temp_path):
        os.remove(temp_path)


def test_mock_vision_model_default(dummy_image):
    model = MockVisionModel()
    response = model.analyze(dummy_image, "Identify UI bugs")
    data = json.loads(response)
    assert data["has_defect"] is True
    assert len(data["findings"]) == 1
    assert data["findings"][0]["defect_category"] == "mobile_button_clipping"
    assert model.call_count == 1
    assert model.last_image_path == dummy_image


def test_mock_vision_model_custom_response(dummy_image):
    custom = json.dumps({"has_defect": False, "findings": []})
    model = MockVisionModel(canned_response=custom)
    response = model.analyze(dummy_image, "Test prompt")
    data = json.loads(response)
    assert data["has_defect"] is False
    assert len(data["findings"]) == 0


def test_mock_vision_model_file_not_found():
    model = MockVisionModel()
    with pytest.raises(FileNotFoundError):
        model.analyze("/non/existent/path.png", "prompt")


def test_mock_vision_model_simulated_error(dummy_image):
    model = MockVisionModel(simulate_error=VLMRateLimitError("Rate limit reached"))
    with pytest.raises(VLMRateLimitError):
        model.analyze(dummy_image, "prompt")


def test_factory_defaults_to_mock():
    # When no provider or 'mock' is specified, should safely return MockVisionModel
    client = get_vision_client("mock")
    assert isinstance(client, MockVisionModel)
    assert isinstance(client, VisionModel)


def test_factory_invalid_provider():
    with pytest.raises(VLMConfigurationError):
        get_vision_client("unsupported_provider_xyz")


def test_gemini_missing_api_key(monkeypatch):
    monkeypatch.delenv("VLM_API_KEY", raising=False)
    with pytest.raises(VLMConfigurationError, match="Gemini API key is required"):
        GeminiVisionModel(api_key="")


def test_sanitize_error_message():
    raw_query = "Error requesting https://api.google.com/test?key=AIzaSySecretKey123&other=val"
    sanitized = sanitize_error_message(raw_query)
    assert "AIzaSySecretKey123" not in sanitized
    assert "key=[REDACTED]" in sanitized

    raw_bearer = "Authorization: Bearer sk-secret123456789 token failed"
    sanitized_bearer = sanitize_error_message(raw_bearer)
    assert "sk-secret123456789" not in sanitized_bearer
    assert "Bearer [REDACTED]" in sanitized_bearer


def test_retry_on_transient_error():
    attempts = 0

    def flaky_operation():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise VLMRateLimitError("Too Many Requests")
        return "success"

    result = execute_with_retry(
        flaky_operation,
        max_retries=3,
        initial_delay=0.01,
        backoff_factor=1.0
    )
    assert result == "success"
    assert attempts == 3


def test_no_retry_on_auth_error():
    attempts = 0

    def failing_auth():
        nonlocal attempts
        attempts += 1
        raise VLMAuthenticationError("Invalid API key")

    with pytest.raises(VLMAuthenticationError):
        execute_with_retry(
            failing_auth,
            max_retries=3,
            initial_delay=0.01
        )
    # Auth errors should fail immediately on first attempt
    assert attempts == 1
