"""VLM client: a thin, replaceable wrapper around the vision-language model."""
from abc import ABC, abstractmethod


class VisionModel(ABC):
    """Interface every provider implements."""

    @abstractmethod
    def analyze(self, image_path: str, prompt: str) -> str:
        """Send one image plus a prompt; return the raw model text."""
        raise NotImplementedError