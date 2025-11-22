// sandbox.js

// Функция, которая будет безопасно исполнять пользовательский скрипт
window.processHTMLInSandbox = function(html, customScript) {
    try {
        const processHTML = new Function('html', customScript + '; return processHTML(html);');
        return processHTML(html);
    } catch (err) {
        // Отправляем ошибку обратно в background.js
        return JSON.stringify({ error: err.message });
    }
};

// Обработчик сообщений из background.js
window.addEventListener('message', async (event) => {
    // Проверяем происхождение сообщения в реальном расширении!
    if (event.origin !== "chrome-extension://" + chrome.runtime.id) return;

    const { html, customScript, id } = event.data;

    // Выполняем пользовательский скрипт
    const result = window.processHTMLInSandbox(html, customScript);

    // Отправляем результат обратно
    parent.postMessage({
        id: id,
        result: result
    }, '*'); // В продакшене лучше указать конкретный origin
});