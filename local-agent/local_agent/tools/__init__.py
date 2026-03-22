"""LangChain tools for the local agent."""
from local_agent.tools.cli_tools import exec_claude, exec_codex, run_test, run_build
from local_agent.tools.knowledge_tools import knowledge_search, knowledge_store
from local_agent.tools.file_tools import read_file, write_file, list_files

def get_all_tools():
    return [exec_claude, exec_codex, run_test, run_build, knowledge_search, knowledge_store, read_file, write_file, list_files]
