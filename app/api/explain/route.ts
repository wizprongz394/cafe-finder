import { NextRequest, NextResponse } from "next/server";

const cache = new Map<string, { text: string; expires: number }>();
const CACHE_TTL = 10 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const prompt = body?.prompt;
    const cacheKey = body?.cacheKey;

    if (!prompt) {
      return NextResponse.json({ error: "No prompt" }, { status: 400 });
    }

    // 🔥 Cache check
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        console.log("⚡ CACHE HIT");
        return NextResponse.json({ text: cached.text, cached: true });
      }
    }

    console.log("🔥 OpenRouter API HIT");

    if (!process.env.OPENROUTER_API_KEY) {
      console.error("❌ Missing API KEY");
      return NextResponse.json({ error: "No API key" }, { status: 500 });
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Cafe Finder App"
      },
      body: JSON.stringify({
        model: "openrouter/auto",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 120,
        temperature: 0.7
      }),
    });

    const data = await res.json();

    console.log("🧠 RAW:", data);

    if (!res.ok) {
      console.error("❌ API ERROR:", data);
      return NextResponse.json(
        { error: data?.error?.message || "LLM failed" },
        { status: 500 }
      );
    }

    // ✅ SAFE EXTRACTION
    let text = "";

    if (data?.choices?.[0]?.message?.content) {
      text = data.choices[0].message.content;
    } else {
      console.error("❌ BAD FORMAT:", data);
      return NextResponse.json(
        { error: "Invalid response format" },
        { status: 500 }
      );
    }

    text = text.trim();

    // 🔥 Cache save
    if (cacheKey && text) {
      cache.set(cacheKey, {
        text,
        expires: Date.now() + CACHE_TTL
      });
    }

    return NextResponse.json({ text });

  } catch (err) {
    console.error("💥 Backend crash:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}