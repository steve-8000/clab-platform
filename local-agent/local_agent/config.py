"""Agent configuration and LLM model factory."""
from __future__ import annotations
import os
from dataclasses import dataclass, field

@dataclass
class AgentConfig:
    control_plane_url: str = "http://localhost:8000"
    knowledge_url: str = "http://localhost:4007"
    llm_provider: str = "anthropic"  # "anthropic" or "openai"
    llm_model: str = ""
    workdir: str = "."
    max_retries: int = 3
    max_iterations: int = 20
    interrupt_before_execute: bool = False

_config: AgentConfig | None = None

def configure(config: AgentConfig) -> None:
    global _config
    _config = config

def get_config() -> AgentConfig:
    global _config
    if _config is None:
        _config = AgentConfig(
            control_plane_url=os.getenv("CONTROL_PLANE_URL", "http://localhost:8000"),
            knowledge_url=os.getenv("KNOWLEDGE_SERVICE_URL", "http://localhost:4007"),
            llm_provider=os.getenv("LLM_PROVIDER", "anthropic"),
            llm_model=os.getenv("LLM_MODEL", ""),
            workdir=os.getenv("WORKDIR", os.getcwd()),
        )
    return _config

def get_model():
    """Get LLM based on config."""
    config = get_config()
    provider = config.llm_provider

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        model_name = config.llm_model or "gpt-4o"
        return ChatOpenAI(model=model_name)
    else:
        from langchain_anthropic import ChatAnthropic
        model_name = config.llm_model or "claude-sonnet-4-20250514"
        return ChatAnthropic(model=model_name)
