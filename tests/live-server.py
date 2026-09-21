"""Isolated real Knowledge Engine server for extension transport tests."""
import os
import sys
from pathlib import Path

source_dir = os.environ.get("NOESIS_SOURCE_DIR")
if not source_dir:
    raise SystemExit("Set NOESIS_SOURCE_DIR to a Noesis backend checkout for integration tests.")
root = Path(source_dir).expanduser().resolve()
if not (root / "tools/knowledge_engine_mcp/server.py").is_file():
    raise SystemExit("NOESIS_SOURCE_DIR must contain tools/knowledge_engine_mcp/server.py")
sys.path.insert(0, str(root))
import duckdb
from tools.knowledge_engine_mcp.server import mcp
from src.mcp_host.transport import run_server

with duckdb.connect(os.environ['NOESIS_DB_PATH']):
    pass
run_server(mcp)
