// sidepanel.js

// Находим элементы панели
const statusEl = document.getElementById('status');
const urlPatternInput = document.getElementById('urlPattern');
const enabledCheckbox = document.getElementById('enabled');
const rulesContainer = document.getElementById('rulesContainer');
const customJSInput = document.getElementById('customJS');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const addConfigBtn = document.getElementById('addConfigBtn');
const tabs = document.querySelectorAll('.tab');
const config = {
    enabled: false,
    rules: []
};

// Загружаем сохраненную конфигурацию
function loadConfig() {
    return new Promise((res, rej) => {
        chrome.storage.local.get(['config'], (data) => {
            try {
                const parsed = JSON.parse(data.config)
                Object.assign(config, parsed);
                res();
            } catch(e) {
                console.error('failed to parse json', e);
                rej();
            }
        })
    });
}

let abortControllersMap = new Map()

function render(fullRerender = false) {
    if (fullRerender) {
        const ruleCards = [...rulesContainer.querySelectorAll('.card[data-rule-i]')];
        ruleCards.forEach(ruleCard => {
            ruleCard.remove();
        })
        abortControllersMap.forEach(ctrl => ctrl.abort())
        abortControllersMap.clear();
    }

    config.rules.forEach((rule, i) => {
        let ruleCard = rulesContainer.querySelector(`.card[data-rule-i="${i}"]`);
        let removeRuleBtn = document.querySelector(`#rule-${i}-removeBtn`);
        let urlPatternInput = document.querySelector(`#rule-${i}-urlPatternInput`);
        let customJsScript = document.querySelector(`#rule-${i}-customJsScript`);
        let customHeadInput = document.querySelector(`#rule-${i}-customHead`);
        let enabledCheckbox = document.querySelector(`#rule-${i}-enabledCheckbox`);
        let customBodyInput = document.querySelector(`#rule-${i}-customBody`);


        if (!abortControllersMap.get(i)) {
            abortControllersMap.set(i, new AbortController())
        }

        const abortController = abortControllersMap.get(i);

        if (!ruleCard || fullRerender) {
            ruleCard = document.createElement('div');
            ruleCard.classList.add('card');
            ruleCard.setAttribute('data-rule-i', i);
            ruleCard.innerHTML=`
        <button class="remove-rule" id="rule-${i}-removeBtn">❌</button>
        <div class="form-group">
          <label class="rule-input-label" for="rule-${i}-urlPatternInput"><input type="checkbox" id="rule-${i}-enabledCheckbox" checked />URL pattern:</label>
          <input type="text" id="rule-${i}-urlPatternInput" placeholder="" />
          <div class="hint">
            Wildcard pattern for intercept requests (example:
            *://example.com/*)
          </div>
        </div>
        <div class="form-group">
          <label for="rule-${i}-customHead">Extra content for &lt;head&gt; tag</label>
          <textarea
            id="rule-${i}-customHead"
            rows="2"
            placeholder=""
          ></textarea>
          <div class="hint">
            Input should container valid HTML
          </div>
        </div>
        <div class="form-group">
          <label for="rule-${i}-customBody">Extra content for &lt;body&gt; tag</label>
          <textarea
            id="rule-${i}-customBody"
            rows="2"
            placeholder=""
          ></textarea>
          <div class="hint">
            Input should container valid HTML
          </div>
        </div>
        <div class="form-group">
          <label for="rule-${i}-customJsScript">Custom JS Script URL:</label>
          <input type="text" id="rule-${i}-customJsScript" placeholder="" />
          <div class="hint">
            Example: https://unpkg.com/mobx-view-model-devtools/auto.global.js
          </div>
        </div>
        `;
            rulesContainer.appendChild(ruleCard);

            removeRuleBtn = ruleCard.querySelector(`#rule-${i}-removeBtn`);
            removeRuleBtn.addEventListener('click', () => {
                saveConfigurationLazy.cancel();
                config.rules.splice(i, 1);
                render(true);
            }, { signal: abortController.signal });

            urlPatternInput = document.querySelector(`#rule-${i}-urlPatternInput`);
            urlPatternInput.value = rule.urlPattern || ''
            urlPatternInput.addEventListener('input', (e) => {
                rule.urlPattern = e.target.value.trim();
                saveConfigurationLazy(config);
            }, { signal: abortController.signal });

            customJsScript = document.querySelector(`#rule-${i}-customJsScript`);
            customJsScript.value = rule.customJsScript || ''
            customJsScript.addEventListener('input', (e) => {
                rule.customJsScript = e.target.value.trim();
                saveConfigurationLazy(config);
            }, { signal: abortController.signal });

            customHeadInput = document.querySelector(`#rule-${i}-customHead`);
            customHeadInput.value = rule.customHead || ''
            customHeadInput.addEventListener('input', (e) => {
                rule.customHead = e.target.value.trim();
                saveConfigurationLazy(config);
            }, { signal: abortController.signal });

            customBodyInput = document.querySelector(`#rule-${i}-customBody`);
            customBodyInput.value = rule.customBody || ''
            customBodyInput.addEventListener('input', (e) => {
                rule.customBody = e.target.value.trim();
                saveConfigurationLazy(config);
            }, { signal: abortController.signal });


            enabledCheckbox = document.querySelector(`#rule-${i}-enabledCheckbox`);
            enabledCheckbox.checked = rule.enabled === true;
            enabledCheckbox.addEventListener('change', (e) => {
                rule.enabled = enabledCheckbox.checked === true;
                saveConfigurationLazy(config);
            }, { signal: abortController.signal });
        } else {
            urlPatternInput.value = rule.urlPattern || ''
            customHeadInput.value = rule.customHead || ''
            customBodyInput.value = rule.customBody || ''
            customJsScript.value = rule.customJsScript || ''
            enabledCheckbox.checked = rule.enabled === true;
        }
    });
}

// Настройка обработчиков событий
function setupEventListeners() {
    enabledCheckbox.checked = config.enabled === true;
    enabledCheckbox.addEventListener('change', () => {
        config.enabled = enabledCheckbox.checked === true;
        saveConfiguration(config, true);
    })
    // Сохраняем конфигурацию
    addConfigBtn.addEventListener('click', () => {
        config.rules.push({
            urlPattern: '',
            customHead: '',
            customBody: '',
            enabled: true,
        });
        saveConfiguration(config, false)
        render(true);
    });
    
    // Слушаем перехваченные данные от background.js
    chrome.runtime.onMessage.addListener(handleRuntimeMessage);
}

const saveConfiguration = (config, isReloadPage = true) => {
    chrome.storage.local.set({ config: JSON.stringify(config) }, () => {
        showStatus('✅ Configuration saved', 'success');
        // Автоматически перезагружаем страницу после сохранения
        if (isReloadPage) {
            reloadTargetPageLazy()
        }
    });
}

const saveConfigurationLazy = _.debounce(saveConfiguration, 1000)

async function attachDebugger(succeedCallback) {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        if (!tab) {
            showStatus('❌ Active tab not found', 'error');
            return;
        }

        chrome.runtime.sendMessage({
            type: 'ATTACH_DEBUGGER',
            tabId: tab.id
        }, (response) => {
            succeedCallback?.();
            if (response && response.success) {
                console.log('✅ Debugger автоматически подключен');
            } else {
                console.log('❌ Ошибка автоматического подключения debugger');
            }
        });
    } catch (error) {
        console.error('Error attaching debugger:', error);
    }
}

// Перезагрузка целевой страницы
async function reloadTargetPage() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id) {
            chrome.tabs.reload(tab.id);
            showStatus('🔄 Page reloading...', 'info');
        }
    } catch (error) {
        console.error('Error reloading page:', error);
    }
}

const reloadTargetPageLazy = _.debounce(reloadTargetPage, 500)

// Обработка сообщений от background.js
function handleRuntimeMessage(message, sender, sendResponse) {
    if (message.type === 'INTERCEPTED_DATA') {
        currentInterceptedData = message;
    }
}

// Переключение табов
function switchTab(tabName) {
    // Убираем активный класс со всех табов
    tabs.forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    // Добавляем активный класс текущему табу
    const activeTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
    const activeContent = document.getElementById(tabName + '-content');
    
    if (activeTab && activeContent) {
        activeTab.classList.add('active');
        activeContent.classList.add('active');
    }
}


function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Показываем статус сообщение
function showStatus(message, type) {
    if (!statusEl) return;
    
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.classList.remove('hidden');
    
    // Автоскрытие для успешных сообщений
    if (type === 'success' || type === 'info') {
        setTimeout(() => {
            statusEl.classList.add('hidden');
        }, 3000);
    }
}

// Обработка ошибок
window.addEventListener('error', function(e) {
    console.error('Global error:', e.error);
    showStatus('❌ Errro: ' + e.error?.message, 'error');
});

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    loadConfig().then(() => {
        render();
        setupEventListeners();
        
        if (config.enabled) {
            setTimeout(() => attachDebugger(reloadTargetPage), 500);
        }
    });
});