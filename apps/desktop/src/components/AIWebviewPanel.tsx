// apps/desktop/src/components/AIWebviewPanel.tsx
import React, { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

interface AIWebviewPanelProps {
  currentServiceUrl: string;
  getActiveEditorText: () => string; // アクティブな教材テキスト/選択箇所の取得関数
  onInsertToEditor: (text: string) => void;
  /**
   * webview-preload.js への file:// パス。
   * 同梱の preload ファイル（apps/desktop/src/preload/webview-preload.js）を
   * ビルド出力先からの絶対パスで解決して渡してください（例: `file://${path.join(__dirname, 'webview-preload.js')}`）。
   */
  preloadPath: string;
}

export interface AIWebviewPanelHandle {
  /** 既存ツールバー [AI] ボタンのドロップダウンからスキル選択時に呼び出す */
  executeSkill: (skillPrompt: string) => void;
}

export const AIWebviewPanel = forwardRef<AIWebviewPanelHandle, AIWebviewPanelProps>(
  ({ currentServiceUrl, getActiveEditorText, onInsertToEditor, preloadPath }, ref) => {
    const webviewRef = useRef<any>(null);

    useEffect(() => {
      const webview = webviewRef.current;
      if (!webview) return;

      const handleIpcMessage = (event: any) => {
        if (event.channel === 'insert-to-sigma') {
          onInsertToEditor(event.args[0]?.text ?? '');
        }
      };

      webview.addEventListener('ipc-message', handleIpcMessage);
      return () => webview.removeEventListener('ipc-message', handleIpcMessage);
    }, [onInsertToEditor]);

    useImperativeHandle(ref, () => ({
      executeSkill: (skillPrompt: string) => {
        const editorContext = getActiveEditorText();
        const webview = webviewRef.current;
        if (webview) {
          webview.send('inject-prompt-with-context', {
            editorContext: editorContext || '(未選択/白紙)',
            userPrompt: skillPrompt,
          });
        }
      },
    }));

    return (
      <div className="w-full h-full flex flex-col">
        {/* eslint-disable-next-line react/no-unknown-property */}
        <webview
          ref={webviewRef}
          src={currentServiceUrl}
          preload={preloadPath}
          className="w-full h-full"
        />
      </div>
    );
  }
);

AIWebviewPanel.displayName = 'AIWebviewPanel';
