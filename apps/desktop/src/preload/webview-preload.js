/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require('electron');

let bridgeConfigPromise = null;

async function getBridgeConfig() {
  if (!bridgeConfigPromise) {
    bridgeConfigPromise = ipcRenderer.invoke('web-ai:get-config');
  }
  return bridgeConfigPromise;
}

async function request(path, options = {}) {
  const config = await getBridgeConfig();
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Web AI request failed: ${response.status}`);
  }
  return payload;
}

contextBridge.exposeInMainWorld('sigmaWebAi', Object.freeze({
  health: () => request('/v1/health'),
  files: () => request('/v1/files'),
  proposals: (fileId) => request(`/v1/proposals?${new URLSearchParams({ fileId }).toString()}`),
  run: (input) => request('/v1/runs', {
    method: 'POST',
    body: JSON.stringify(input),
  }),
  cancel: (runId) => request(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {
    method: 'POST',
  }),
  approveProposal: (proposalId) => request(`/v1/proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: 'POST',
  }),
}));

// 回答ブロックへの [SIGMAへ挿入] ボタン動的注入
function injectSigmaButtons() {
  const blocks = document.querySelectorAll('pre, code, .code-block, .markdown-body pre');

  blocks.forEach((block) => {
    if (block.dataset.sigmaInjected) return;
    block.dataset.sigmaInjected = 'true';

    const btn = document.createElement('button');
    btn.innerText = '✨ SIGMAへ挿入';
    btn.className = 'sigma-insert-btn';

    Object.assign(btn.style, {
      position: 'absolute', top: '8px', right: '80px', zIndex: '9999',
      padding: '4px 10px', fontSize: '12px', fontWeight: 'bold',
      color: '#ffffff', backgroundColor: '#2563eb', border: 'none',
      borderRadius: '6px', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
    });

    btn.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      const textContent = block.innerText.replace('✨ SIGMAへ挿入', '').trim();
      ipcRenderer.sendToHost('insert-to-sigma', { text: textContent, timestamp: Date.now() });

      btn.innerText = '✅ 挿入完了';
      btn.style.backgroundColor = '#059669';
      setTimeout(() => {
        btn.innerText = '✨ SIGMAへ挿入';
        btn.style.backgroundColor = '#2563eb';
      }, 1500);
    };

    if (getComputedStyle(block).position === 'static') block.style.position = 'relative';
    block.appendChild(btn);
  });
}

// 編集中の教材コンテキスト＋スキルプロンプトの自動流し込み
ipcRenderer.on('inject-prompt-with-context', (_event, { editorContext, userPrompt }) => {
  const inputElement = document.querySelector('textarea, div[contenteditable="true"]');
  if (!inputElement) {
    console.warn('[SIGMA webview-preload] 入力欄が見つかりませんでした。サイトのUI変更を確認してください。');
    return;
  }

  const fullPrompt = `【現在編集中の教材コンテキスト】\n${editorContext}\n\n【依頼内容】\n${userPrompt}`;

  if (inputElement.tagName === 'TEXTAREA') {
    inputElement.value = fullPrompt;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    inputElement.innerText = fullPrompt;
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const trySend = (attemptsLeft) => {
    const sendButton = document.querySelector(
      'button[aria-label*="送信"], button[aria-label*="Send"], button[data-testid="send-button"]'
    );
    if (sendButton && !sendButton.disabled) {
      sendButton.click();
      return;
    }
    if (attemptsLeft > 0) {
      setTimeout(() => trySend(attemptsLeft - 1), 300);
    }
  };
  trySend(5);
});

const observer = new MutationObserver(() => injectSigmaButtons());
window.addEventListener('DOMContentLoaded', () => {
  injectSigmaButtons();
  observer.observe(document.body, { childList: true, subtree: true });
});
