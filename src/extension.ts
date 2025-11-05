import * as vscode from 'vscode';

let translatorPanel: vscode.WebviewPanel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    // 注册命令：打开翻译器
    const openTranslatorCommand = vscode.commands.registerCommand('cursor-translator.open', () => {
        createTranslatorPanel(context);
    });

    context.subscriptions.push(openTranslatorCommand);
}

function createTranslatorPanel(context: vscode.ExtensionContext) {
    // 如果面板已经存在，直接显示
    if (translatorPanel) {
        translatorPanel.reveal();
        return;
    }

    // 创建 WebView 面板
    translatorPanel = vscode.window.createWebviewPanel(
        'cursorTranslator',
        'Cursor 翻译器',
        vscode.ViewColumn.Beside,
        {
            enableScripts: true,
            retainContextWhenHidden: true
        }
    );

    // 设置 WebView 内容
    translatorPanel.webview.html = getWebviewContent(context);

    // 处理来自 WebView 的消息
    translatorPanel.webview.onDidReceiveMessage(
        async (message: { command: string; text?: string; fromLang?: string; toLang?: string }) => {
            console.log('收到 WebView 消息:', message);
            try {
                switch (message.command) {
                    case 'translate':
                        if (message.text && message.fromLang && message.toLang) {
                            console.log('开始翻译:', message.text, message.fromLang, message.toLang);
                            await handleTranslate(message.text, message.fromLang, message.toLang);
                            // 发送确认消息回 WebView
                            translatorPanel?.webview.postMessage({
                                command: 'translateStarted',
                                text: '翻译请求已发送'
                            });
                        } else {
                            console.error('翻译参数不完整:', message);
                            vscode.window.showErrorMessage('翻译参数不完整');
                        }
                        break;
                    case 'copy':
                        if (message.text) {
                            await vscode.env.clipboard.writeText(message.text);
                            vscode.window.showInformationMessage('已复制到剪贴板');
                            translatorPanel?.webview.postMessage({
                                command: 'copySuccess'
                            });
                        }
                        break;
                    default:
                        console.warn('未知的命令:', message.command);
                }
            } catch (error) {
                console.error('处理消息时出错:', error);
                vscode.window.showErrorMessage(`处理消息失败: ${error}`);
                translatorPanel?.webview.postMessage({
                    command: 'error',
                    text: String(error)
                });
            }
        },
        undefined,
        context.subscriptions
    );

    // 面板关闭时清理
    translatorPanel.onDidDispose(
        () => {
            translatorPanel = undefined;
        },
        null,
        context.subscriptions
    );
}

async function handleTranslate(text: string, fromLang: string, toLang: string) {
    if (!text.trim()) {
        return;
    }

    try {
        // 方法1: 创建伪诊断错误，触发 Cursor 的 AI 处理
        await triggerCursorAI(text, fromLang, toLang);
        
        // 方法2: 使用命令触发（如果 Cursor 支持）
        // await vscode.commands.executeCommand('workbench.action.chat.open');
    } catch (error) {
        vscode.window.showErrorMessage(`翻译失败: ${error}`);
    }
}

/**
 * 通过创建伪诊断错误来触发 Cursor 的 composer-1
 * 将翻译请求包装成"错误"格式，让 Cursor AI 来处理
 */
async function triggerCursorAI(text: string, fromLang: string, toLang: string) {
    // 方法1: 尝试直接打开 Composer 并发送消息（如果 Cursor 支持）
    try {
        // 尝试打开 Cursor 的 Composer
        await vscode.commands.executeCommand('workbench.action.chat.open');
        
        // 等待一下让窗口打开
        await new Promise<void>(resolve => setTimeout(resolve, 500));
        
        // 尝试发送消息到 Composer（这个命令可能不存在，需要测试）
        const translatePrompt = `Please translate the following text from ${fromLang} to ${toLang}:\n\n${text}\n\nProvide only the translation without any additional explanation.`;
        
        // 尝试通过命令发送（Cursor 可能有特定命令）
        try {
            await vscode.commands.executeCommand('workbench.action.chat.send', translatePrompt);
        } catch (e) {
            // 如果命令不存在，使用备选方案
            vscode.window.showInformationMessage(
                `翻译请求：请将以下文本翻译从 ${fromLang} 到 ${toLang}:\n${text}`,
                '已复制到剪贴板'
            );
            await vscode.env.clipboard.writeText(translatePrompt);
        }
        
        return;
    } catch (e) {
        // 如果 Composer 命令不存在，使用诊断方法
    }

    // 方法2: 创建伪诊断错误（备选方案）
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
        // 如果没有打开的文件，创建一个临时文件
        const doc = await vscode.workspace.openTextDocument({
            content: generatePseudoError(text, fromLang, toLang),
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
        
        // 创建诊断
        const uri = doc.uri;
        const diagnostics = vscode.languages.createDiagnosticCollection('cursor-translator');
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(0, 0, 0, 100),
            `[TRANSLATE REQUEST] Translate from ${fromLang} to ${toLang}: ${text}`,
            vscode.DiagnosticSeverity.Information
        );
        diagnostic.source = 'cursor-translator';
        diagnostics.set(uri, [diagnostic]);
        
        // 触发 Cursor 的 AI 处理
        setTimeout(() => {
            vscode.commands.executeCommand('workbench.action.problems.focus');
        }, 100);
        
        return;
    }

    // 如果已有打开的编辑器，在当前位置插入伪错误代码
    const editor = activeEditor;
    const position = editor.selection.active;
    
    // 生成伪错误代码
    const pseudoError = generatePseudoError(text, fromLang, toLang);
    
    // 插入到编辑器
    await editor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(position, pseudoError);
    });

    // 创建诊断来触发 Cursor AI
    const uri = editor.document.uri;
    const diagnostics = vscode.languages.createDiagnosticCollection('cursor-translator');
    const diagnostic = new vscode.Diagnostic(
        new vscode.Range(position.line, position.character, position.line, position.character + pseudoError.length),
        `[TRANSLATE] ${fromLang} → ${toLang}: ${text.substring(0, 50)}${text.length > 50 ? '...' : ''}`,
        vscode.DiagnosticSeverity.Information
    );
    diagnostic.source = 'cursor-translator';
    diagnostic.code = {
        value: 'TRANSLATE_REQUEST',
        target: vscode.Uri.parse(`cursor-translator:translate?text=${encodeURIComponent(text)}&from=${fromLang}&to=${toLang}`)
    };
    
    diagnostics.set(uri, [diagnostic]);
    
    // 尝试触发 Cursor 的 composer
    setTimeout(async () => {
        // 方法1: 尝试打开问题面板，让用户点击触发 AI
        await vscode.commands.executeCommand('workbench.action.problems.focus');
        
        // 方法2: 显示提示信息
        vscode.window.showInformationMessage(
            `翻译请求已创建（${fromLang} → ${toLang}），请点击问题面板中的诊断项或打开 Cursor Composer 来处理`
        );
    }, 300);
}

/**
 * 生成伪错误代码，用于触发 Cursor AI
 * 使用更明显的格式，让 Cursor AI 更容易识别
 */
function generatePseudoError(text: string, fromLang: string, toLang: string): string {
    const langNames: { [key: string]: string } = {
        'zh': '中文',
        'en': 'English',
        'ja': '日本語',
        'ko': '한국어',
        'fr': 'Français',
        'de': 'Deutsch',
        'es': 'Español'
    };
    
    return `\n/*\n * [TRANSLATE REQUEST]\n * Source: ${langNames[fromLang] || fromLang} (${fromLang})\n * Target: ${langNames[toLang] || toLang} (${toLang})\n * \n * Text to translate:\n * ${text.split('\n').join('\n * ')}\n * \n * Please translate the above text to ${langNames[toLang] || toLang}.\n */\n`;
}

function getWebviewContent(context: vscode.ExtensionContext): string {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Cursor 翻译器</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
        }
        
        .header {
            padding: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .header h1 {
            font-size: 18px;
            font-weight: 600;
        }
        
        .container {
            flex: 1;
            display: flex;
            overflow: hidden;
        }
        
        .input-section, .output-section {
            flex: 1;
            display: flex;
            flex-direction: column;
            border-right: 1px solid var(--vscode-panel-border);
        }
        
        .output-section {
            border-right: none;
        }
        
        .section-header {
            padding: 12px 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .language-select {
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }
        
        .text-area {
            flex: 1;
            padding: 16px;
            border: none;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-size: 14px;
            font-family: 'Courier New', monospace;
            resize: none;
            outline: none;
        }
        
        .output-area {
            flex: 1;
            padding: 16px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            font-size: 14px;
            font-family: 'Courier New', monospace;
            overflow-y: auto;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .action-bar {
            padding: 12px 16px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            gap: 8px;
        }
        
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn-primary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-primary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .status {
            padding: 8px 16px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            border-top: 1px solid var(--vscode-panel-border);
        }
        
        .loading {
            display: none;
            color: var(--vscode-textLink-foreground);
        }
        
        .loading.active {
            display: inline;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🌐 Cursor 翻译器</h1>
        <span style="font-size: 12px; color: var(--vscode-descriptionForeground);">
            使用 Composer-1 进行翻译
        </span>
    </div>
    
    <div class="container">
        <div class="input-section">
            <div class="section-header">
                <select id="fromLang" class="language-select">
                    <option value="zh">中文</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="es">Español</option>
                </select>
                <span style="font-size: 12px; margin-left: auto;">输入文本</span>
            </div>
            <textarea id="inputText" class="text-area" placeholder="在此输入要翻译的文本..."></textarea>
            <div class="action-bar">
                <button class="btn btn-primary" id="translateBtn">翻译</button>
                <button class="btn" id="clearBtn">清空</button>
                <button class="btn" id="copyInputBtn">复制</button>
            </div>
        </div>
        
        <div class="output-section">
            <div class="section-header">
                <select id="toLang" class="language-select">
                    <option value="en">English</option>
                    <option value="zh">中文</option>
                    <option value="ja">日本語</option>
                    <option value="ko">한국어</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                    <option value="es">Español</option>
                </select>
                <span style="font-size: 12px; margin-left: auto;">翻译结果</span>
            </div>
            <div id="outputText" class="output-area">
                翻译结果将显示在这里...
                <br><br>
                <small style="color: var(--vscode-descriptionForeground);">
                    点击"翻译"按钮后，系统会创建伪诊断错误并触发 Cursor Composer-1 来处理翻译请求。
                    请查看问题面板或 Composer 窗口获取翻译结果。
                </small>
            </div>
            <div class="action-bar">
                <button class="btn" id="copyOutputBtn">复制结果</button>
            </div>
        </div>
    </div>
    
    <div class="status">
        <span id="statusText">就绪</span>
        <span id="loading" class="loading">处理中...</span>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        // 调试：检查元素是否存在
        console.log('初始化 WebView...');
        
        const inputText = document.getElementById('inputText');
        const outputText = document.getElementById('outputText');
        const translateBtn = document.getElementById('translateBtn');
        const clearBtn = document.getElementById('clearBtn');
        const copyInputBtn = document.getElementById('copyInputBtn');
        const copyOutputBtn = document.getElementById('copyOutputBtn');
        const fromLang = document.getElementById('fromLang');
        const toLang = document.getElementById('toLang');
        const statusText = document.getElementById('statusText');
        const loading = document.getElementById('loading');
        
        // 检查所有元素是否存在
        if (!inputText || !outputText || !translateBtn || !clearBtn || !copyInputBtn || !copyOutputBtn || !fromLang || !toLang || !statusText || !loading) {
            console.error('元素未找到:', {
                inputText: !!inputText,
                outputText: !!outputText,
                translateBtn: !!translateBtn,
                clearBtn: !!clearBtn,
                copyInputBtn: !!copyInputBtn,
                copyOutputBtn: !!copyOutputBtn,
                fromLang: !!fromLang,
                toLang: !!toLang,
                statusText: !!statusText,
                loading: !!loading
            });
        }
        
        // 翻译按钮点击事件
        translateBtn.addEventListener('click', () => {
            console.log('翻译按钮被点击');
            const text = inputText.value.trim();
            if (!text) {
                statusText.textContent = '请输入要翻译的文本';
                return;
            }
            
            statusText.textContent = '正在触发 Cursor Composer...';
            loading.classList.add('active');
            
            const translateData = {
                command: 'translate',
                text: text,
                fromLang: fromLang.value,
                toLang: toLang.value
            };
            
            console.log('发送翻译消息:', translateData);
            
            try {
                vscode.postMessage(translateData);
                console.log('消息已发送');
            } catch (error) {
                console.error('发送消息失败:', error);
                statusText.textContent = '发送失败: ' + error;
                return;
            }
            
            // 显示提示信息
            const fromLangValue = fromLang.value;
            const displayText = text;
            outputText.innerHTML = \`
                <div style="color: var(--vscode-textLink-foreground);">
                    ⚡ 翻译请求已发送到 Cursor Composer-1
                </div>
                <br>
                <div style="color: var(--vscode-descriptionForeground);">
                    请查看以下位置获取翻译结果：
                    <ul style="margin-top: 8px;">
                        <li>问题面板（Problems）- 查看诊断信息</li>
                        <li>Composer 窗口 - AI 会自动处理翻译请求</li>
                    </ul>
                </div>
                <br>
                <div style="font-family: monospace; background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; margin-top: 8px;">
                    原文 (\${fromLangValue}):<br>
                    \${displayText.replace(/\n/g, '<br>')}
                </div>
            \`;
            
            setTimeout(() => {
                loading.classList.remove('active');
                statusText.textContent = '翻译请求已发送';
            }, 1000);
        });
        
        // 清空按钮
        clearBtn.addEventListener('click', () => {
            console.log('清空按钮被点击');
            inputText.value = '';
            outputText.textContent = '翻译结果将显示在这里...';
            statusText.textContent = '已清空';
        });
        
        // 复制输入按钮
        copyInputBtn.addEventListener('click', () => {
            console.log('复制输入按钮被点击');
            const text = inputText.value;
            if (text) {
                try {
                    vscode.postMessage({ command: 'copy', text: text });
                    statusText.textContent = '已复制输入内容';
                } catch (error) {
                    console.error('复制失败:', error);
                    statusText.textContent = '复制失败';
                }
            }
        });
        
        // 复制输出按钮
        copyOutputBtn.addEventListener('click', () => {
            console.log('复制输出按钮被点击');
            const text = outputText.textContent;
            if (text && text !== '翻译结果将显示在这里...') {
                try {
                    vscode.postMessage({ command: 'copy', text: text });
                    statusText.textContent = '已复制翻译结果';
                } catch (error) {
                    console.error('复制失败:', error);
                    statusText.textContent = '复制失败';
                }
            }
        });
        
        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            console.log('收到扩展消息:', event.data);
            const message = event.data;
            switch (message.command) {
                case 'updateTranslation':
                    outputText.textContent = message.text;
                    statusText.textContent = '翻译完成';
                    loading.classList.remove('active');
                    break;
                case 'translateStarted':
                    statusText.textContent = message.text || '翻译请求已发送';
                    break;
                case 'copySuccess':
                    statusText.textContent = '已复制到剪贴板';
                    break;
                case 'error':
                    statusText.textContent = '错误: ' + message.text;
                    loading.classList.remove('active');
                    console.error('扩展错误:', message.text);
                    break;
            }
        });
        
        console.log('WebView 初始化完成');
    </script>
</body>
</html>`;
}

export function deactivate() {}
