import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();

    console.log("🔥 OpenRouter API HIT");

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000", // required by OpenRouter
        "X-Title": "Cafe Finder App"
      },
      body: JSON.stringify({
        model: "openrouter/auto",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ],
        max_tokens: 120
      }),
    });

    const data = await res.json();

    console.log("🧠 OpenRouter Response:", data);

    if (!res.ok) {
      return NextResponse.json(
        { error: data?.error?.message || "LLM failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      text: data?.choices?.[0]?.message?.content || ""
    });

  } catch (err) {
    console.error("💥 Backend error:", err);
    return NextResponse.json(
      { error: "Server error" },
      { status: 500 }
    );
  }
}