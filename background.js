// background.js

let debuggeeTabId = null;

const config = {
    rules: []
};
let urlPattern = '';
let customScript = '';
let isInterceptorActive = true;
let sandboxIframe = null;
let requestQueue = new Map();
let sandboxReady = false;

chrome.storage.local.get(['config'], (data) => {
    try {
        const parsed = JSON.parse(data.config)
        Object.assign(config, parsed);
    } catch(_) {}
})


// Открываем sidepanel при клике на иконку
chrome.action.onClicked.addListener((tab) => {
  // Пробуем использовать sidePanel API если доступно
  if (chrome.sidePanel && chrome.sidePanel.open) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  } else {
    // Fallback: открываем как отдельное окно
    chrome.windows.create({
      url: chrome.runtime.getURL('sidepanel.html'),
      type: 'popup',
      width: 600,
      height: 800,
      left: Math.round(screen.width / 2 - 300),
      top: Math.round(screen.height / 2 - 400)
    });
  }
});


let devtoolsScriptCache = new Map()

// Создаем offscreen document если его нет
async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) {
    return;
  }
  
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER'],
    justification: 'Execute user scripts safely'
  });
}

async function fetchDevtoolsScript(url) {
  if (devtoolsScriptCache.has(url)) {
    return devtoolsScriptCache.get(url);
  }

  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'FETCH_SCRIPT',
      url: url,
    }, (response) => {
      if (response?.success) {
        devtoolsScriptCache.set(url, response.data);
        resolve(response.data);
      } else {
        reject(new Error(response?.error || 'Failed to fetch'));
      }
    });
  });
}


// Слушаем сообщения от sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'ATTACH_DEBUGGER':
      attachDebugger(message.tabId).then(success => {
        sendResponse({ success });
      });
      return true;

    default:
      sendResponse({ success: false, error: 'Unknown message type' });
  }
});

// Автоподключение к новым вкладкам если включено
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    setTimeout(async () => {
      try {
        await attachDebugger(tabId);
        console.log('Auto-attached debugger to tab:', tabId);
      } catch (error) {
        console.error('Auto-attach failed:', error);
      }
    }, 300);
  }
});


async function attachDebugger(tabId) {
  if (debuggeeTabId && debuggeeTabId !== tabId) {
    try {
      await chrome.debugger.detach({ tabId: debuggeeTabId });
    } catch (error) {
      // Игнорируем ошибки отключения
    }
  }
  
  debuggeeTabId = tabId;
  const debuggee = { tabId };

  try {
    await chrome.debugger.attach(debuggee, '1.3');
    await chrome.debugger.sendCommand(debuggee, 'Fetch.enable', {
      patterns: [{ urlPattern: '*', requestStage: 'Response' }]
    });
    
    console.log('Debugger attached to tab', tabId);
    return true;
  } catch (error) {
    console.log('Failed to attach debugger:', error);
    
    if (error.message.includes('Another debugger')) {
      try {
        await chrome.debugger.sendCommand(debuggee, 'Fetch.enable', {
          patterns: [{ urlPattern: '*', requestStage: 'Response' }]
        });
        debuggeeTabId = tabId;
        return true;
      } catch (retryError) {
        console.error('Failed to reuse debugger:', retryError);
      }
    }
    
    return false;
  }
}

// Обработка событий Fetch
chrome.debugger.onEvent.addListener(async (debuggee, method, params) => {
  if (method === 'Fetch.requestPaused' && isInterceptorActive) {
    const { requestId, request, responseStatusCode, responseHeaders, resourceType } = params;

    const matchedRules = getMatchedRules(request.url, config);

    if (!matchedRules.length) {
      await chrome.debugger.sendCommand(debuggee, 'Fetch.continueRequest', { requestId });
      return;
    }

    const contentTypeHeader = responseHeaders?.find(h => 
      h.name.toLowerCase() === 'content-type'
    );
    
    const contentType = contentTypeHeader?.value?.toLowerCase() || '';
    const isHTML = contentType.includes('text/html') || 
                   contentType.includes('application/xhtml+xml') ||
                   resourceType === 'Document';

    if (!isHTML) {
      await chrome.debugger.sendCommand(debuggee, 'Fetch.continueRequest', { requestId });
      return;
    }

    try {
      const response = await chrome.debugger.sendCommand(debuggee, 'Fetch.getResponseBody', { requestId });
      let html = response.body;

      if (response.base64Encoded) {
        html = decodeBase64(html);
      }

      if (!html.includes('<body') || !html.includes('</body>') || !html.includes('<head') || !html.includes('</head>')) {
        await chrome.debugger.sendCommand(debuggee, 'Fetch.continueRequest', { requestId });
        return;
      } 

      // Используем новую функцию safeProcessHTML с offscreen document
      const modifiedHtml = await safeProcessHTML(html, config.rules);

      try {
        await chrome.runtime.sendMessage({
          type: 'INTERCEPTED_DATA',
          url: request.url,
          originalHtml: html,
          modifiedHtml: modifiedHtml,
          timestamp: new Date().toISOString(),
          contentLength: html.length,
          modifiedContentLength: modifiedHtml.length
        });
      } catch (messageError) {
        console.log('Could not send message to sidepanel', messageError);
      }

      const base64Body = encodeToBase64(modifiedHtml);

      await chrome.debugger.sendCommand(debuggee, 'Fetch.fulfillRequest', {
        requestId,
        responseCode: responseStatusCode || 200,
        responseHeaders: updateContentLength(responseHeaders, modifiedHtml.length),
        body: base64Body
      });

    } catch (error) {
      console.error('Error processing request:', error);
      await chrome.debugger.sendCommand(debuggee, 'Fetch.continueRequest', { requestId });
    }
  }
});

function decodeBase64(base64) {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (error) {
    console.warn('Standard base64 decode failed, trying alternative:', error);
    try {
      return decodeURIComponent(escape(atob(base64)));
    } catch (altError) {
      console.error('All base64 decode methods failed:', altError);
      return base64;
    }
  }
}

function encodeToBase64(str) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    return btoa(String.fromCharCode(...data));
  } catch (error) {
    console.warn('Standard base64 encode failed, trying alternative:', error);
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (altError) {
      console.error('All base64 encode methods failed:', altError);
      return str;
    }
  }
}


function matchPattern(url, pattern) {
  if (!pattern || !url) return false;
  
  try {
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    if (!regexPattern.startsWith('^')) regexPattern = '^' + regexPattern;
    if (!regexPattern.endsWith('$')) regexPattern = regexPattern + '$';
    
    const regex = new RegExp(regexPattern);
    return regex.test(url);
  } catch (error) {
    console.error('Invalid pattern:', pattern, error);
    return false;
  }
}

function getMatchedRules(url, config) {
  const allRules = (config.rules || []);

  return allRules.filter(rule => {
    return matchPattern(url, rule.urlPattern)
  });
}


// Безопасное выполнение пользовательского скрипта
async function safeProcessHTML(html, inputRules) {let proceedHtml = html;

  const rules = (inputRules || []).slice()

  for await (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    if (rule.customHead) {
      proceedHtml = proceedHtml.replace(`</head>`, `${rule.customHead}</head>`);
    }

    if (rule.customBody) {
      proceedHtml = proceedHtml.replace(`</body>`, `${rule.customBody}</body>`);
    }

    if (rule.customJsScript) {
        let customLoadedJsScript = '';
        try {  
          customLoadedJsScript = await fetchDevtoolsScript(rule.customJsScript);
          console.log('Devtools script loaded, length:', customLoadedJsScript.length);
        } catch (e) {
          console.warn('Failed to load devtools script:', e);
        }

        if (customLoadedJsScript) {
            try {
              const scriptTag = `<script type="text/javascript" data-script="html-interceptor">
${customLoadedJsScript.replaceAll('<', '\<').replaceAll('\\', '\\\\')}
          </script></head>`;
              
              proceedHtml = proceedHtml.replace('</head>', scriptTag);
            console.log('✓ Script injected (base64)');
          } catch (e) {
            console.error('Failed to inject script:', e);
          }
        }
    }
  }

  return proceedHtml;
}


// Декодирование base64 с поддержкой UTF-8
function decodeBase64(base64) {
  try {
    // Пробуем стандартный подход
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (error) {
    console.warn('Standard base64 decode failed, trying alternative:', error);
    // Альтернативный метод для сложных случаев
    try {
      return decodeURIComponent(escape(atob(base64)));
    } catch (altError) {
      console.error('All base64 decode methods failed:', altError);
      return base64; // Возвращаем как есть в случае неудачи
    }
  }
}

// Кодирование в base64 с поддержкой UTF-8
function encodeToBase64(str) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    return btoa(String.fromCharCode(...data));
  } catch (error) {
    console.warn('Standard base64 encode failed, trying alternative:', error);
    // Альтернативный метод
    try {
      return btoa(unescape(encodeURIComponent(str)));
    } catch (altError) {
      console.error('All base64 encode methods failed:', altError);
      return str; // Возвращаем как есть в случае неудачи
    }
  }
}

// Функция для обновления Content-Length
function updateContentLength(headers, newLength) {
  if (!headers) return headers;
  
  const newHeaders = [];
  let contentLengthUpdated = false;

  for (const header of headers) {
    if (header.name.toLowerCase() === 'content-length') {
      newHeaders.push({ ...header, value: String(newLength) });
      contentLengthUpdated = true;
    } else {
      newHeaders.push(header);
    }
  }

  // Если заголовка Content-Length не было, добавляем его
  if (!contentLengthUpdated) {
    newHeaders.push({
      name: 'Content-Length',
      value: String(newLength)
    });
  }

  return newHeaders;
}

// Улучшенное сопоставление паттернов с wildcard
function matchPattern(url, pattern) {
  if (!pattern || !url) return false;
  
  try {
    // Экранируем специальные символы кроме * и ?
    let regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    // Добавляем якоря если их нет
    if (!regexPattern.startsWith('^')) regexPattern = '^' + regexPattern;
    if (!regexPattern.endsWith('$')) regexPattern = regexPattern + '$';
    
    const regex = new RegExp(regexPattern);
    return regex.test(url);
  } catch (error) {
    console.error('Invalid pattern:', pattern, error);
    return false;
  }
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === debuggeeTabId) {
    debuggeeTabId = null;
  }
});

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === debuggeeTabId) {
    debuggeeTabId = null;
    console.log('Debugger detached from tab', source.tabId);
  }
});

chrome.runtime.onSuspend.addListener(() => {
  if (debuggeeTabId) {
    chrome.debugger.detach({ tabId: debuggeeTabId });
  }
});

chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    try {
      const parsed = JSON.parse(changes.config.newValue);
      Object.assign(config, parsed);
    } catch(_) {}
  }
});

