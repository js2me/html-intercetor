// offscreen.js

// Функция для обработки HTML с пользовательским скриптом
function processHTML(html, customScript) {
    try {

      const domParser = new DOMParser();
      const doc = domParser.parseFromString(html, 'text/html');

      const customScript = doc.createElement('script');
      customScript.textContent = customScript;
      doc.head.appendChild(customScript)

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);   
        // // Создаем функцию из пользовательского скрипта, которая будет принимать HTML и возвращать модифицированный HTML
        // // Убираем обертку function processHTML(...) {} чтобы пользовательская функция могла быть написана как в примере
        // const processFunction = new Function('html', customScript);
        // const result = processFunction(html);
        // return result;
    } catch (err) {
        // В случае ошибки возвращаем оригинальный HTML и логируем ошибку
        console.error('Error in custom script:', err);
        return html;
    }
}

// Слушаем сообщения от background.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'PROCESS_HTML') {
        const { html, customScript } = message;
        const modifiedHtml = processHTML(html, customScript);
        sendResponse({ result: modifiedHtml });
    }
});
