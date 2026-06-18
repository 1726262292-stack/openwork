const CHAT_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>__AGENT_NAME__</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; height: 100vh; display: flex; flex-direction: column; }
  #header { padding: 16px 24px; border-bottom: 1px solid #2a2a2a; display: flex; align-items: center; gap: 12px; }
  #header h1 { font-size: 16px; font-weight: 600; color: #fff; }
  #header .dot { width: 8px; height: 8px; border-radius: 50%; background: #44BA81; }
  #header .dot.idle { background: #666; }
  #messages { flex: 1; overflow-y: auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }
  .msg { max-width: 80%; padding: 12px 16px; border-radius: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
  .msg.user { align-self: flex-end; background: #2563eb; color: #fff; }
  .msg.agent { align-self: flex-start; background: #1e1e1e; border: 1px solid #2a2a2a; }
  .msg.error { align-self: center; background: #7f1d1d; color: #fca5a5; text-align: center; font-size: 14px; }
  #input-bar { padding: 16px 24px; border-top: 1px solid #2a2a2a; display: flex; gap: 12px; }
  #input { flex: 1; padding: 12px 16px; background: #1a1a1a; border: 1px solid #333; border-radius: 8px; color: #e0e0e0; font-size: 15px; outline: none; }
  #input:focus { border-color: #2563eb; }
  #input:disabled { opacity: 0.5; }
  #send { padding: 12px 24px; background: #2563eb; color: #fff; border: none; border-radius: 8px; font-size: 15px; cursor: pointer; font-weight: 500; }
  #send:disabled { opacity: 0.5; cursor: not-allowed; }
  #send:hover:not(:disabled) { background: #1d4ed8; }
  .typing { display: inline-block; width: 6px; height: 16px; background: #666; animation: blink 1s infinite; }
  @keyframes blink { 0%,50% { opacity: 1; } 51%,100% { opacity: 0; } }
</style>
</head>
<body>
<div id="header">
  <div class="dot" id="status-dot"></div>
  <h1>__AGENT_NAME__</h1>
</div>
<div id="messages"></div>
<div id="input-bar">
  <input id="input" type="text" placeholder="Send a message..." autocomplete="off" />
  <button id="send">Send</button>
</div>
<script>
const AGENT_NAME = "__AGENT_NAME__";
const messages = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const statusDot = document.getElementById('status-dot');
let sessionId = 'web-' + Math.random().toString(36).slice(2, 8);
let busy = false;

function addMsg(text, cls) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function setBusy(b) {
  busy = b;
  input.disabled = b;
  sendBtn.disabled = b;
  statusDot.className = 'dot' + (b ? '' : ' idle');
  if (!b) input.focus();
}

async function sendMessage(text) {
  if (busy || !text.trim()) return;
  addMsg(text, 'user');
  input.value = '';
  setBusy(true);
  const typing = addMsg('', 'agent');
  typing.innerHTML = '<span class="typing"></span>';

  try {
    const res = await fetch('/agents/' + AGENT_NAME + '/' + sessionId, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      const err = await res.text();
      typing.remove();
      addMsg('Error: ' + (err || res.status), 'error');
      return;
    }
    const { streamUrl, offset } = await res.json();
    typing.remove();

    let agentDiv = addMsg('', 'agent');
    let agentText = '';

    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 500));
      const sr = await fetch(streamUrl + '?offset=' + offset);
      if (!sr.ok) continue;
      const events = await sr.json();
      if (!Array.isArray(events) || events.length === 0) continue;

      for (const ev of events) {
        if (ev.type === 'message_start' || ev.type === 'message_end') {
          const content = ev.message && ev.message.content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === 'text' && part.text) agentText += part.text;
            }
          }
        }
        if (ev.type === 'operation') {
          if (ev.isError) {
            agentDiv.remove();
            addMsg('Agent error: ' + (ev.error && ev.error.message ? ev.error.message : ev.error || 'unknown'), 'error');
          } else {
            agentDiv.textContent = agentText || '(no response)';
          }
          setBusy(false);
          return;
        }
      }
      if (agentText) agentDiv.textContent = agentText;
    }
    addMsg('Timed out waiting for response', 'error');
    setBusy(false);
  } catch (err) {
    typing.remove();
    addMsg('Network error: ' + err.message, 'error');
    setBusy(false);
  }
}

sendBtn.addEventListener('click', () => sendMessage(input.value));
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(input.value); });
setBusy(false);
input.focus();
</script>
</body>
</html>`;

const SLACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Slack — __AGENT_DISPLAY_NAME__</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Lato', -apple-system, BlinkMacSystemFont, sans-serif; font-size: 15px; height: 100vh; display: flex; overflow: hidden; }
  /* Sidebar */
  #sidebar { width: 260px; background: #1a1d21; color: #bcabbc; display: flex; flex-direction: column; flex-shrink: 0; }
  #workspace-header { padding: 16px 16px 12px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  #workspace-header .ws-name { color: #fff; font-size: 18px; font-weight: 700; }
  #workspace-header .ws-user { font-size: 13px; color: #9a8b9a; margin-top: 2px; }
  .channel-section { padding: 16px 0 4px; }
  .channel-section-title { padding: 0 16px 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #7a6a7a; letter-spacing: 0.5px; }
  .channel-item { padding: 4px 16px; cursor: pointer; display: flex; align-items: center; gap: 6px; font-size: 15px; color: #cfb8cf; }
  .channel-item:hover { background: rgba(255,255,255,0.04); }
  .channel-item.active { background: rgba(255,255,255,0.08); color: #fff; }
  .channel-item .hash { color: #7a6a7a; font-weight: 400; }
  .channel-item .dm-avatar { width: 18px; height: 18px; border-radius: 4px; background: #e01e5a; display: flex; align-items: center; justify-content: center; font-size: 10px; color: #fff; font-weight: 700; }
  /* Main */
  #main { flex: 1; display: flex; flex-direction: column; background: #fff; }
  #channel-header { padding: 12px 20px; border-bottom: 1px solid #e1e1e1; display: flex; align-items: center; gap: 8px; }
  #channel-header .hash { color: #717674; font-size: 20px; font-weight: 300; }
  #channel-header .name { font-size: 16px; font-weight: 700; color: #1d1c1d; }
  #channel-header .desc { font-size: 13px; color: #616061; margin-left: 8px; }
  #messages { flex: 1; overflow-y: auto; padding: 16px 20px; }
  .msg-row { display: flex; gap: 12px; padding: 6px 0; }
  .msg-row:hover { background: #f8f8f8; }
  .msg-avatar { width: 36px; height: 36px; border-radius: 4px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 15px; color: #fff; font-weight: 700; }
  .msg-content { flex: 1; min-width: 0; }
  .msg-meta { display: flex; align-items: baseline; gap: 6px; margin-bottom: 2px; }
  .msg-name { font-size: 15px; font-weight: 700; color: #1d1c1d; }
  .msg-name.bot { color: #e01e5a; }
  .msg-time { font-size: 12px; color: #616061; }
  .msg-text { font-size: 15px; line-height: 1.45; color: #1d1c1d; white-space: pre-wrap; word-break: break-word; }
  .msg-typing { font-size: 15px; color: #616061; font-style: italic; }
  .msg-typing .dots { display: inline-block; }
  .msg-typing .dots span { animation: bounce 1.4s infinite; }
  .msg-typing .dots span:nth-child(2) { animation-delay: 0.2s; }
  .msg-typing .dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes bounce { 0%,60%,100% { opacity: 0.3; } 30% { opacity: 1; } }
  /* Input */
  #input-bar { padding: 0 20px 16px; }
  #input-wrap { border: 1px solid #868686; border-radius: 4px; display: flex; flex-direction: column; }
  #input { width: 100%; padding: 10px 12px; border: none; outline: none; font-size: 15px; font-family: inherit; resize: none; }
  #input-bar-actions { display: flex; align-items: center; padding: 4px 8px; gap: 8px; }
  #send-btn { background: #007a5a; color: #fff; border: none; padding: 4px 12px; border-radius: 4px; font-size: 13px; cursor: pointer; font-weight: 600; }
  #send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  #send-btn:hover:not(:disabled) { background: #14856b; }
</style>
</head>
<body>
<div id="sidebar">
  <div id="workspace-header">
    <div class="ws-name">Agent Lab</div>
    <div class="ws-user">You</div>
  </div>
  <div class="channel-section">
    <div class="channel-section-title">Channels</div>
    <div class="channel-item active" data-channel="general"><span class="hash">#</span> general</div>
    <div class="channel-item" data-channel="support"><span class="hash">#</span> support</div>
    <div class="channel-item" data-channel="random"><span class="hash">#</span> random</div>
  </div>
  <div class="channel-section">
    <div class="channel-section-title">Direct Messages</div>
    <div class="channel-item" data-channel="dm"><span class="dm-avatar">A</span> __AGENT_DISPLAY_NAME__</div>
  </div>
</div>
<div id="main">
  <div id="channel-header">
    <span class="hash">#</span>
    <span class="name" id="channel-name">general</span>
    <span class="desc" id="channel-desc">Talk to your agent</span>
  </div>
  <div id="messages"></div>
  <div id="input-bar">
    <div id="input-wrap">
      <input id="input" type="text" placeholder="Message #general" autocomplete="off" />
      <div id="input-bar-actions">
        <button id="send-btn">Send</button>
      </div>
    </div>
  </div>
</div>
<script>
const AGENT_NAME = "__AGENT_NAME__";
const AGENT_DISPLAY = "__AGENT_DISPLAY_NAME__";
const messagesEl = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send-btn');
const channelName = document.getElementById('channel-name');
const channelDesc = document.getElementById('channel-desc');
let currentChannel = 'general';
let busy = false;

const channelConfigs = {
  general: { name: 'general', desc: 'Talk to your agent', session: 'slack-general' },
  support: { name: 'support', desc: 'Get help from your agent', session: 'slack-support' },
  random: { name: 'random', desc: 'Casual chat with your agent', session: 'slack-random' },
  dm: { name: AGENT_DISPLAY, desc: 'Direct message', session: 'slack-dm' },
};

function formatTime() {
  const d = new Date();
  let h = d.getHours();
  const m = d.getMinutes().toString().padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return h + ':' + m + ' ' + ampm;
}

function addMsg(name, text, isBot, color) {
  const row = document.createElement('div');
  row.className = 'msg-row';
  const initial = name.charAt(0).toUpperCase();
  const avatarColor = color || (isBot ? '#e01e5a' : '#3b6fc0');
  row.innerHTML = '<div class="msg-avatar" style="background:' + avatarColor + '">' + initial + '</div>' +
    '<div class="msg-content">' +
    '<div class="msg-meta"><span class="msg-name' + (isBot ? ' bot' : '') + '">' + name + '</span>' +
    '<span class="msg-time">' + formatTime() + '</span></div>' +
    '<div class="msg-text">' + escapeHtml(text) + '</div>' +
    '</div>';
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return row;
}

function addTyping() {
  const row = document.createElement('div');
  row.className = 'msg-row';
  row.id = 'typing-row';
  row.innerHTML = '<div class="msg-avatar" style="background:#e01e5a">' + AGENT_DISPLAY.charAt(0) + '</div>' +
    '<div class="msg-content"><div class="msg-typing"><span class="dots"><span>.</span><span>.</span><span>.</span></span> ' + AGENT_DISPLAY + ' is typing</div></div>';
  messagesEl.appendChild(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function setBusy(b) {
  busy = b;
  input.disabled = b;
  sendBtn.disabled = b;
  if (!b) input.focus();
}

function switchChannel(ch) {
  currentChannel = ch;
  const cfg = channelConfigs[ch];
  channelName.textContent = cfg.name;
  channelDesc.textContent = cfg.desc;
  input.placeholder = 'Message ' + (ch === 'dm' ? '@' : '#') + cfg.name;
  messagesEl.innerHTML = '';
  document.querySelectorAll('.channel-item').forEach(el => el.classList.toggle('active', el.dataset.channel === ch));
  input.focus();
}

document.querySelectorAll('.channel-item').forEach(el => {
  el.addEventListener('click', () => switchChannel(el.dataset.channel));
});

async function sendMessage(text) {
  if (busy || !text.trim()) return;
  addMsg('You', text, false, '#3b6fc0');
  input.value = '';
  setBusy(true);
  addTyping();
  const cfg = channelConfigs[currentChannel];

  try {
    const res = await fetch('/agents/' + AGENT_NAME + '/' + cfg.session, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    if (!res.ok) {
      const err = await res.text();
      document.getElementById('typing-row')?.remove();
      addMsg(AGENT_DISPLAY, 'Error: ' + (err || res.status), true);
      setBusy(false);
      return;
    }
    const { streamUrl, offset } = await res.json();
    document.getElementById('typing-row')?.remove();
    let row = addMsg(AGENT_DISPLAY, '', true);
    let textEl = row.querySelector('.msg-text');
    let agentText = '';

    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 500));
      const sr = await fetch(streamUrl + '?offset=' + offset);
      if (!sr.ok) continue;
      const events = await sr.json();
      if (!Array.isArray(events) || events.length === 0) continue;

      for (const ev of events) {
        if (ev.type === 'message_start' || ev.type === 'message_end') {
          const content = ev.message && ev.message.content;
          if (Array.isArray(content)) {
            for (const part of content) {
              if (part.type === 'text' && part.text) agentText += part.text;
            }
          }
        }
        if (ev.type === 'operation') {
          if (ev.isError) {
            textEl.textContent = 'Error: ' + (ev.error && ev.error.message ? ev.error.message : 'unknown');
          } else {
            textEl.textContent = agentText || '(no response)';
          }
          setBusy(false);
          return;
        }
      }
      if (agentText) textEl.textContent = agentText;
    }
    textEl.textContent = agentText || '(timed out)';
    setBusy(false);
  } catch (err) {
    document.getElementById('typing-row')?.remove();
    addMsg(AGENT_DISPLAY, 'Network error: ' + err.message, true);
    setBusy(false);
  }
}

sendBtn.addEventListener('click', () => sendMessage(input.value));
input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(input.value); });
switchChannel('general');
</script>
</body>
</html>`;

export function generateAppTs(agentName: string, agentDisplayName: string): string {
  const chatHtml = CHAT_HTML.replaceAll("__AGENT_NAME__", agentName);
  const slackHtml = SLACK_HTML
    .replaceAll("__AGENT_NAME__", agentName)
    .replaceAll("__AGENT_DISPLAY_NAME__", agentDisplayName);
  return [
    `import { Hono } from "hono";`,
    `import { flue } from "@flue/runtime/routing";`,
    ``,
    `const app = new Hono();`,
    ``,
    `app.get("/health", (c) => c.json({ ok: true }));`,
    `app.route("/", flue());`,
    `app.get("/", (c) => c.html(${JSON.stringify(chatHtml)}));`,
    `app.get("/slack", (c) => c.html(${JSON.stringify(slackHtml)}));`,
    ``,
    `export default app;`,
    ``,
  ].join("\n");
}
