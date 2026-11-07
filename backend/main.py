"""Entry point:  uvicorn main:app --reload   (run from the backend/ folder)."""
from api import create_app

app = create_app()