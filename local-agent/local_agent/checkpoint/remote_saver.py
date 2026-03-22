"""RemoteCheckpointSaver — stores LangGraph checkpoints on the Control Plane via HTTP."""
from __future__ import annotations
import httpx
import logging
from typing import Any, Iterator
from collections.abc import Sequence

from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)
from langchain_core.runnables import RunnableConfig

logger = logging.getLogger(__name__)

# Key constants (matching LangGraph internals)
CONF = "configurable"
THREAD_ID = "thread_id"
CHECKPOINT_ID = "checkpoint_id"
CHECKPOINT_NS = "checkpoint_ns"
RUN_ID = "run_id"


class RemoteCheckpointSaver(BaseCheckpointSaver[str]):
    """Checkpoint saver that persists to the Control Plane HTTP API.

    This allows a local LangGraph agent to store its state on a remote K8s server,
    enabling resume-from-checkpoint, state inspection, and multi-device continuity.
    """

    def __init__(self, control_plane_url: str, timeout: float = 30.0):
        super().__init__()
        self.url = control_plane_url.rstrip("/")
        self.timeout = timeout
        self._client = httpx.Client(base_url=self.url, timeout=timeout)

    def _get_thread_id(self, config: RunnableConfig) -> str:
        return config.get(CONF, {}).get(THREAD_ID, "")

    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        thread_id = self._get_thread_id(config)
        if not thread_id:
            return None

        try:
            resp = self._client.get(f"/checkpoints/{thread_id}")
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()

            checkpoint = data.get("checkpoint", {})
            metadata = data.get("metadata", {})

            return CheckpointTuple(
                config=config,
                checkpoint=checkpoint,
                metadata=metadata,
                parent_config=None,
                pending_writes=[],
            )
        except httpx.HTTPError as e:
            logger.warning(f"Failed to get checkpoint: {e}")
            return None

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        thread_id = self._get_thread_id(config)
        if not thread_id:
            return config

        try:
            # Serialize checkpoint (convert non-serializable types)
            cp_data = dict(checkpoint)
            meta_data = dict(metadata) if metadata else {}
            conf = config.get(CONF, {})
            if conf.get(RUN_ID):
                meta_data.setdefault(RUN_ID, conf[RUN_ID])
            if conf.get(CHECKPOINT_NS):
                meta_data.setdefault(CHECKPOINT_NS, conf[CHECKPOINT_NS])
            if cp_data.get("parent_checkpoint_id"):
                meta_data.setdefault("parent_checkpoint_id", cp_data.get("parent_checkpoint_id"))

            resp = self._client.put(
                f"/checkpoints/{thread_id}",
                json={"checkpoint": cp_data, "metadata": meta_data},
            )
            resp.raise_for_status()
            saved = resp.json()
            checkpoint_id = saved.get("id") or checkpoint.get("id", "")

            # Return config with checkpoint_id
            return {
                **config,
                CONF: {
                    **config.get(CONF, {}),
                    CHECKPOINT_ID: checkpoint_id,
                },
            }
        except httpx.HTTPError as e:
            logger.warning(f"Failed to put checkpoint: {e}")
            return config

    def list(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        if not config:
            return

        thread_id = self._get_thread_id(config)
        if not thread_id:
            return

        try:
            resp = self._client.get(
                f"/checkpoints/{thread_id}/history",
                params={"limit": str(limit or 10)},
            )
            resp.raise_for_status()

            for entry in resp.json():
                yield CheckpointTuple(
                    config=config,
                    checkpoint=entry.get("checkpoint", {}),
                    metadata=entry.get("metadata", {}),
                    parent_config=None,
                    pending_writes=[],
                )
        except httpx.HTTPError as e:
            logger.warning(f"Failed to list checkpoints: {e}")

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: tuple[str | int | tuple, ...] = (),
    ) -> None:
        # For now, writes are bundled into the next checkpoint
        pass

    def __del__(self):
        try:
            self._client.close()
        except Exception:
            pass
