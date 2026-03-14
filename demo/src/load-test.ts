const ENDPOINT = "http://localhost:3001/chat";

const PROMPTS = [
  "Explain quantum computing",
  "Write a haiku about frogs",
  "What is the capital of Uruguay?",
  "How does TCP work?",
  "Translate hello to Japanese",
];

async function sendRequest() {
  const prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)]!;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    const status = data.ok ? "✅" : "❌";
    console.log(`${status} [${data.model ?? "error"}] ${prompt}`);
  } catch (error) {
    console.log(`💀 ${String(error)}`);
  }
}

async function run() {
  console.log("🐸👁️ Load test started — sending requests every 2s\n");

  setInterval(sendRequest, 2000);
}

run();
