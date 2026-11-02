// ai.js
//
// The phone app's door to the SAME Flask AI server the website uses (on
// Render). The Groq key lives only on that server, never in the app: an APK
// can be unpacked, so anything inside it should be treated as public.
//
// The AI only SUGGESTS. Every value it returns is checked again here, again
// when the lead is saved, and again by firestore.rules.

export const AI_BASE_URL = "https://lrdlr-ai.onrender.com";

const SLOW_HINT_MS = 5000;   // after this, say the free server may be waking up
const HARD_STOP_MS = 75000;  // give up after this

/**
 * POSTs JSON to the AI server and returns the parsed answer.
 * onSlow() is called once if the server takes longer than a few seconds
 * (the free Render server sleeps outside 9 AM - 9 PM and takes ~1 min to wake).
 * Throws an Error with a message a person can act on.
 */
export async function aiPost(path, body, { onSlow } = {}) {
  const controller = new AbortController();
  const slow = setTimeout(() => onSlow && onSlow(), SLOW_HINT_MS);
  const stop = setTimeout(() => controller.abort(), HARD_STOP_MS);
  try {
    const res = await fetch(`${AI_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The AI server returned ${res.status}.`);
    return data;
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The AI took too long. Try again in a minute.");
    if (/network request failed/i.test(err.message)) {
      throw new Error("Can't reach the AI server. Check your internet, or try again in a minute.");
    }
    throw err;
  } finally {
    clearTimeout(slow);
    clearTimeout(stop);
  }
}

export const WAKING_UP = "Waking up the AI server. The first try after a break can take up to a minute…";
