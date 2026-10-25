// ai-config.js
//
// Where the AI server lives. On your own computer (npm run serve) the page
// talks to the Flask server you started with `python app.py`. On the live
// site it talks to the Render deployment.
//
// After deploying to Render, paste your Render URL into RENDER_URL below.

const RENDER_URL = "https://lrdlr-ai.onrender.com"; // replace after Render deploy
const LOCAL_URL = "http://127.0.0.1:5000";

const isLocal = ["127.0.0.1", "localhost"].includes(window.location.hostname);

export const AI_BASE_URL = isLocal ? LOCAL_URL : RENDER_URL;