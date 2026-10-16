// Minimal client for a Gemma model served by Ollama (local or in the deploy
// container). Every caller has a deterministic fallback, so Gemma being slow
// or down degrades wording, never dispatch.
export async function gemmaChat(system: string, user: string, opts: { json?: boolean; timeoutMs?: number } = {}): Promise<string | null> {
  const baseUrl = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
  const model = process.env.GEMMA_MODEL ?? "gemma3:4b";
  try {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
      body: JSON.stringify({
        model,
        stream: false,
        ...(opts.json ? { format: "json" } : {}),
        options: { temperature: opts.json ? 0 : 0.7 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function gemmaJson(system: string, user: string, timeoutMs?: number): Promise<unknown | null> {
  const raw = await gemmaChat(system, user, { json: true, timeoutMs });
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
