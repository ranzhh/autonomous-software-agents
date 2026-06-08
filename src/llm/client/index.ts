/**
 * llm/client — the boundary to the language model. A thin client over the course
 * LiteLLM proxy (OpenAI-compatible, via the `openai` SDK) plus a `MockLlmClient`
 * so the whole LLM stack is offline-testable. Request/response mapping is
 * isolated here, so prompt/agentic logic upstream never touches transport.
 *
 * Intended files (added in Phase 5):
 *   - llm-client.ts  — LlmClient interface (chat completions).
 *   - litellm.ts     — real client over the OpenAI SDK + course endpoint.
 *   - mock-client.ts — deterministic MockLlmClient for tests.
 */

export {};
