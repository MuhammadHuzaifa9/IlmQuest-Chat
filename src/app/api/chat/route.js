import { NextResponse } from "next/server";

const HF_API_KEY = process.env.HUGGINGFACE_API_KEY;
const HF_MODEL = "deepseek-ai/DeepSeek-V3-0324:fastest"; // Supported by inference providers

export async function POST(req) {
  try {
    const { question, history = [] } = await req.json();

    if (!question) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }

    // System prompt to set persona and instruct follow-ups
    const systemPrompt = `
You are an expert Islamic Q&A Assistant named Ilmquest.
Answer questions based on the Quran, Hadith, and Islamic scholarship.
Be concise, accurate, and respectful.

At the end of your answer, provide 3 short suggested follow-up questions that a user might ask next.
Format them as a JSON array under "suggested_followups".
`;

    // Build messages (last 10 chat messages maximum)
    const messages = [
      { role: "system", content: systemPrompt },
      ...history.slice(-10),
      { role: "user", content: question },
    ];

    // Call the Hugging Face Router chat endpoint
    const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: HF_MODEL,
        messages,
        max_tokens: 700,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    const data = await response.json();

    // Extract the AI message
    const rawMessage =
  data?.choices?.[0]?.message?.content?.toString() ||
  "No response generated";

// Split on delimiter to separate answer and followups
const DELIM = "===SUGGESTED_FOLLOWUPS===";
let answerText = rawMessage;
let suggestedFollowups = [];

if (rawMessage.includes(DELIM)) {
  const [answerPart, followupPartRaw] = rawMessage.split(DELIM);

  // Clean the answer
  answerText = answerPart.trim();

  // Clean candidate JSON (strip backticks/fences and whitespace)
  const cleanJson = followupPartRaw
    .replace(/```json|```/gi, "")
    .trim();

  // Try to parse as JSON array; if it’s an object, try extracting .suggested_followups
  try {
    const parsed = JSON.parse(cleanJson);
    if (Array.isArray(parsed)) {
      suggestedFollowups = parsed.filter((s) => typeof s === "string");
    } else if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.suggested_followups)
    ) {
      suggestedFollowups = parsed.suggested_followups.filter(
        (s) => typeof s === "string"
      );
    }
  } catch {
    // If parsing fails, attempt to extract the first [...] array from the cleaned text
    const arrayMatch = cleanJson.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        const maybeArr = JSON.parse(arrayMatch[0]);
        if (Array.isArray(maybeArr)) {
          suggestedFollowups = maybeArr.filter((s) => typeof s === "string");
        }
      } catch {
        // ignore
      }
    }
  }
} else {
  // Backward-compatible: try to strip any code-fenced JSON block from the end
  const fenced = rawMessage.match(/```(?:json)?[\s\S]*?```/gi);
  if (fenced && fenced.length) {
    // Remove fenced block from visible text
    answerText = rawMessage.replace(fenced[fenced.length - 1], "").trim();

    // Try to parse the last fenced block
    const last = fenced[fenced.length - 1]
      .replace(/```json|```/gi, "")
      .trim();
    try {
      const parsed = JSON.parse(last);
      if (Array.isArray(parsed)) {
        suggestedFollowups = parsed.filter((s) => typeof s === "string");
      } else if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray(parsed.suggested_followups)
      ) {
        suggestedFollowups = parsed.suggested_followups.filter(
          (s) => typeof s === "string"
        );
      }
    } catch {
      // ignore
    }
  }
}

return NextResponse.json({
  text: answerText,
  citations: [
    { source: "Islamic Scholarship", content: "Based on Quran and Hadith" },
  ],
  suggested_followups: suggestedFollowups,
  history: [
    ...history,
    { role: "user", content: question },
    { role: "assistant", content: answerText },
  ],
});

} catch (error) {
console.error("Chat API error:", error);
return NextResponse.json(
{ error: "Failed to get response from AI" },
{ status: 500 }
);
}
}