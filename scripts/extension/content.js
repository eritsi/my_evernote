/**
 * content.js
 * - 選択されたテキスト/画像を含む「直近の共通祖先要素」を取得してバックグラウンドへ送る
 */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GET_SELECTED_HTML") return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    sendResponse({ error: "テキストまたは画像が選択されていません" });
    return;
  }

  // 選択範囲の共通祖先要素を取得
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;

  // テキストノードの場合は親要素へ
  const element =
    ancestor.nodeType === Node.ELEMENT_NODE
      ? ancestor
      : ancestor.parentElement;

  // outerHTMLを返す（選択された構造をまるごと保存）
  sendResponse({
    html: element.outerHTML,
    title: document.title,
    url: location.href,
  });
});
