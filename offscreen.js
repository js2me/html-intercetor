chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_SCRIPT') {
    fetch(message.url, { 
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
    })
      .then(response => response.text())
      .then(data => {
        sendResponse({ success: true, data });
      })
      .catch(error => {
        sendResponse({ success: false, error: error.message });
      });
    
    return true; // Async response
  }
});