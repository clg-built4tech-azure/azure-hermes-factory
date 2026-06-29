"use strict";

// a2a.js — Agent2Agent (A2A) protocol layer for Hermes AI agents.
//
// Implements the A2A v0.3.0 contract over JSON-RPC 2.0 / HTTP:
//   - Discovery:  GET  /.well-known/agent-card.json  (served by agent.js)
//   - Messaging:  POST /a2a   methods: message/send, tasks/get, tasks/cancel
//   - Client:     sendToPeer() — call another agent's /a2a endpoint
//
// Peer discovery is driven by the A2A_PEERS env var (injected by the Bicep
// infra for Azure Container Apps): "name=https://fqdn,name=https://fqdn".
// See README "Inter-Agent Communication (A2A)".

const http = require("node:http");
const https = require("node:https");
const { randomUUID } = require("node:crypto");

const PROTOCOL_VERSION = "0.3.0";

const config = {
  name: process.env.AGENT_NAME || "hermes",
  selfUrl: (process.env.A2A_SELF_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/+$/, ""),
  authToken: process.env.A2A_AUTH_TOKEN || "",
  // Optional HTTP endpoint of the local runtime (e.g. the openclaw gateway) that
  // actually processes a prompt. When unset, a deterministic reply is returned so
  // the protocol is still exercisable end-to-end.
  executorUrl: process.env.A2A_EXECUTOR_URL || "",
  timeoutMs: Number(process.env.A2A_TIMEOUT_MS || 15000),
};

// ──────────────────────────────────────────────
// Peer registry
// ──────────────────────────────────────────────
function getPeers() {
  const raw = process.env.A2A_PEERS || "";
  const peers = {};
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = entry.indexOf("=");
    if (idx === -1) continue;
    const name = entry.slice(0, idx).trim();
    const url = entry.slice(idx + 1).trim().replace(/\/+$/, "");
    if (name && url) peers[name] = url;
  }
  return peers;
}

// ──────────────────────────────────────────────
// In-memory task store
// ──────────────────────────────────────────────
const tasks = new Map();
const nowIso = () => new Date().toISOString();

function textMessage(role, text) {
  return { role, messageId: randomUUID(), kind: "message", parts: [{ kind: "text", text }] };
}

function extractText(message) {
  if (!message || !Array.isArray(message.parts)) return "";
  return message.parts
    .filter((p) => p && p.kind === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

// ──────────────────────────────────────────────
// Executor — where the agent "does the work" on an incoming message.
// Plug the real Hermes/openclaw runtime in here via A2A_EXECUTOR_URL.
// ──────────────────────────────────────────────
async function runExecutor(text) {
  if (config.executorUrl) {
    try {
      const res = await httpJson("POST", config.executorUrl, { input: text });
      const out = res && (res.output ?? res.text ?? res.result);
      return typeof out === "string" ? out : JSON.stringify(res);
    } catch (err) {
      return `[${config.name}] runtime error: ${err.message}`;
    }
  }
  return `[${config.name}] processed: ${text}`;
}

// ──────────────────────────────────────────────
// JSON-RPC 2.0 dispatch
// ──────────────────────────────────────────────
async function handleRpc(rpc) {
  const id = rpc && rpc.id !== undefined ? rpc.id : null;
  if (!rpc || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") {
    return rpcError(id, -32600, "Invalid Request");
  }
  try {
    switch (rpc.method) {
      case "message/send":
        return await onMessageSend(id, rpc.params || {});
      case "tasks/get":
        return onTasksGet(id, rpc.params || {});
      case "tasks/cancel":
        return onTasksCancel(id, rpc.params || {});
      default:
        return rpcError(id, -32601, `Method not found: ${rpc.method}`);
    }
  } catch (err) {
    return rpcError(id, -32603, `Internal error: ${err.message}`);
  }
}

async function onMessageSend(id, params) {
  const incoming = params.message;
  if (!incoming || !Array.isArray(incoming.parts)) {
    return rpcError(id, -32602, "Invalid params: message.parts is required");
  }
  const text = extractText(incoming);
  const taskId = randomUUID();
  const contextId = incoming.contextId || randomUUID();
  const userMsg = { ...incoming, role: "user", taskId, contextId };

  const task = {
    id: taskId,
    contextId,
    kind: "task",
    status: { state: "working", timestamp: nowIso() },
    history: [userMsg],
    artifacts: [],
  };
  tasks.set(taskId, task);

  const replyText = await runExecutor(text);
  const agentMsg = { ...textMessage("agent", replyText), taskId, contextId };
  task.history.push(agentMsg);
  task.artifacts.push({ id: randomUUID(), parts: [{ kind: "text", text: replyText }] });
  task.status = { state: "completed", message: agentMsg, timestamp: nowIso() };

  return rpcResult(id, { task });
}

function onTasksGet(id, params) {
  const task = tasks.get(params.taskId);
  if (!task) return rpcError(id, -32001, `Task not found: ${params.taskId}`);
  return rpcResult(id, { task });
}

function onTasksCancel(id, params) {
  const task = tasks.get(params.taskId);
  if (!task) return rpcError(id, -32001, `Task not found: ${params.taskId}`);
  const terminal = ["completed", "canceled", "failed", "rejected"];
  if (!terminal.includes(task.status.state)) {
    task.status = { state: "canceled", timestamp: nowIso() };
  }
  return rpcResult(id, { task });
}

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

// ──────────────────────────────────────────────
// Agent Card (A2A discovery document)
// ──────────────────────────────────────────────
function buildAgentCard() {
  const card = {
    protocolVersion: PROTOCOL_VERSION,
    name: config.name,
    description: `Hermes AI Agent "${config.name}" - A2A-enabled agent running on Azure Container Apps.`,
    url: `${config.selfUrl}/a2a`,
    preferredTransport: "JSONRPC",
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["text/plain", "application/json"],
    defaultOutputModes: ["text/plain", "application/json"],
    skills: [
      {
        id: "relay",
        name: "Message relay & processing",
        description: "Accepts a text message, processes it via the local Hermes runtime, and returns a result.",
        tags: ["hermes", "a2a", "relay"],
        inputModes: ["text/plain"],
        outputModes: ["text/plain"],
      },
    ],
    provider: {
      organization: "Hermes AI",
      url: "https://github.com/clg-built4tech-azure/azure-hermes-factory",
    },
  };
  if (config.authToken) {
    card.securitySchemes = { bearer: { type: "http", scheme: "bearer" } };
    card.security = [{ bearer: [] }];
  }
  return card;
}

// ──────────────────────────────────────────────
// Client — send a message to a peer agent's /a2a endpoint
// ──────────────────────────────────────────────
async function sendToPeer(peerName, text, { contextId } = {}) {
  const peers = getPeers();
  const baseUrl = peers[peerName];
  if (!baseUrl) {
    const known = Object.keys(peers).join(", ") || "(none configured)";
    throw new Error(`Unknown peer "${peerName}". Known peers: ${known}`);
  }
  const rpc = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: "message/send",
    params: { message: { ...textMessage("user", text), ...(contextId ? { contextId } : {}) } },
  };
  const headers = {};
  if (config.authToken) headers.authorization = `Bearer ${config.authToken}`;
  return httpJson("POST", `${baseUrl}/a2a`, rpc, headers);
}

// ──────────────────────────────────────────────
// Auth — verify the bearer token on inbound A2A requests
// ──────────────────────────────────────────────
function checkAuth(headers) {
  if (!config.authToken) return true;
  const h = headers.authorization || headers.Authorization || "";
  return h === `Bearer ${config.authToken}`;
}

// ──────────────────────────────────────────────
// Minimal HTTP/HTTPS JSON client
// ──────────────────────────────────────────────
function httpJson(method, url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error(`Invalid URL: ${url}`));
    }
    const lib = u.protocol === "https:" ? https : http;
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request(
      {
        method,
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        headers: {
          "content-type": "application/json",
          ...(payload ? { "content-length": payload.length } : {}),
          ...headers,
        },
        timeout: config.timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch (e) {
            reject(new Error(`Bad JSON from ${url}: ${e.message}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = {
  config,
  PROTOCOL_VERSION,
  getPeers,
  handleRpc,
  buildAgentCard,
  sendToPeer,
  checkAuth,
  extractText,
};
