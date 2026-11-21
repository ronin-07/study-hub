"""Vercel Services entrypoint for Study Hub FastAPI.

Vercel's API service root is backend/; routes are exposed under /api/*.
"""
from app.main import app
