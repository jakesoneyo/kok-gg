"""Claude 호출 경계 — 서비스는 `LLM` 프로토콜만 알고, 테스트는 가짜로 바꾼다."""

from dataclasses import dataclass
from typing import Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


@dataclass
class LLMResult[T]:
    parsed: T
    input_tokens: int
    output_tokens: int


class LLM(Protocol):
    def parse(
        self, *, model: str, system: str, user: str, schema: type[T], max_tokens: int
    ) -> LLMResult[T]: ...


class AnthropicLLM:
    """구조화 출력(`messages.parse`)으로 스키마를 강제한다. 도구는 일절 주지 않는다(인젝션 방어)."""

    def __init__(self, api_key: str):
        import anthropic

        self._client = anthropic.Anthropic(api_key=api_key, max_retries=2, timeout=60)

    def parse(
        self, *, model: str, system: str, user: str, schema: type[T], max_tokens: int
    ) -> LLMResult[T]:
        res = self._client.messages.parse(
            model=model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_format=schema,
        )
        if res.parsed_output is None:
            raise ValueError(f"구조화 출력 없음(stop_reason={res.stop_reason})")
        return LLMResult(res.parsed_output, res.usage.input_tokens, res.usage.output_tokens)
