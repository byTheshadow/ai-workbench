/**
 * Companion AI 聊天模块管理器 - 增强版
 * 支持：多会话、单条删除、特定消息引用、重试（Re-roll）多版本选择、保留 Emoji
 */
const ChatManager = {
    sessions: [],
    activeSessionId: null,
    presets: [],
    currentQuote: null, // { id: string, text: string } 暂存的引用消息

    init() {
        this.cacheDOM();
        this.loadData();
        this.bindEvents();
        this.renderPresets();
        this.renderSessions();
        this.fetchModels();
    },

    cacheDOM() {
        this.modelSelect = document.getElementById('ai-model-select');
        this.presetSelect = document.getElementById('ai-preset-select');
        this.sessionsTabs = document.getElementById('ai-sessions-tabs');
        this.newSessionBtn = document.getElementById('ai-new-session-btn');
        this.activeSessionTitle = document.getElementById('active-session-title');
        this.clearHistoryBtn = document.getElementById('ai-clear-history-btn');
        this.deleteSessionBtn = document.getElementById('ai-delete-session-btn');
        this.chatBody = document.getElementById('ai-chat-body');
        this.chatInput = document.getElementById('ai-chat-input');
        this.sendBtn = document.getElementById('ai-send-btn');
        this.connectionStatus = document.getElementById('ai-connection-status');
        
        // 引用组件DOM缓存
        this.quotePreviewBar = document.getElementById('ai-quote-preview-bar');
        this.quotePreviewText = document.getElementById('quote-preview-text');
        this.cancelQuoteBtn = document.getElementById('ai-cancel-quote-btn');
    },

    loadData() {
        const data = StorageManager.getData();
        this.sessions = data.chatSessions || [];
        
        // 兼容处理：确保所有的历史会话及其消息都含有唯一 ID 和多版本属性
        let upgraded = false;
        if (this.sessions.length === 0) {
            this.sessions = [
                {
                    id: 'session_default',
                    title: '默认会话',
                    presetId: 'chat',
                    model: '',
                    messages: [
                        { id: 'msg_init', role: 'assistant', content: '你好。我是你的创作助手。你可以点击上方新建不同的会话，并切换不同的专业预设身份来辅助你。' }
                    ]
                }
            ];
            upgraded = true;
        }

        this.sessions.forEach(session => {
            session.messages.forEach(msg => {
                if (!msg.id) {
                    msg.id = 'msg_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
                    upgraded = true;
                }
                if (msg.role === 'assistant') {
                    if (!msg.versions) {
                        msg.versions = [msg.content];
                        msg.activeVersionIndex = 0;
                        upgraded = true;
                    }
                }
            });
        });

        if (upgraded) {
            this.saveData();
        }

        this.presets = data.aiPresets || [];
        
        this.activeSessionId = localStorage.getItem('studio_workbench_active_session');
        if (!this.activeSessionId || !this.sessions.some(s => s.id === this.activeSessionId)) {
            this.activeSessionId = this.sessions[0].id;
        }
    },

    saveData() {
        const data = StorageManager.getData();
        data.chatSessions = this.sessions;
        StorageManager.save(data);
        localStorage.setItem('studio_workbench_active_session', this.activeSessionId);
    },

    bindEvents() {
        this.newSessionBtn.addEventListener('click', () => this.createNewSession());
        this.presetSelect.addEventListener('change', (e) => this.handlePresetChange(e.target.value));
        this.modelSelect.addEventListener('change', (e) => this.handleModelChange(e.target.value));
        this.clearHistoryBtn.addEventListener('click', () => this.clearActiveSessionHistory());
        this.deleteSessionBtn.addEventListener('click', () => this.deleteActiveSession());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        
        this.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        this.cancelQuoteBtn.addEventListener('click', () => this.clearQuoteState());

        const aiToggleBtn = document.getElementById('ai-toggle-btn');
        if (aiToggleBtn) {
            aiToggleBtn.addEventListener('click', () => {
                setTimeout(() => this.scrollToBottom(), 100);
            });
        }
    },

    async fetchModels() {
        const data = StorageManager.getData();
        const apiConfig = data.apiConfig;

        if (!apiConfig || !apiConfig.openaiKey) {
            this.modelSelect.innerHTML = '<option value="">未配置 API Key</option>';
            this.connectionStatus.textContent = 'LOCAL-ONLY';
            return;
        }

        this.connectionStatus.textContent = 'CONNECTING';

        try {
            const url = `${apiConfig.openaiUrl}/models`;
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiConfig.openaiKey}`,
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const result = await response.json();
            
            if (result && result.data && Array.isArray(result.data)) {
                const blacklistPatterns = [/dall-e/i, /whisper/i, /tts/i, /embed/i, /moderation/i, /edit/i];
                let models = result.data
                    .map(m => m.id)
                    .filter(id => !blacklistPatterns.some(pattern => pattern.test(id)));

                models.sort((a, b) => {
                    const getWeight = (name) => {
                        if (name.includes('gpt-4o')) return 1;
                        if (name.includes('gpt-4')) return 2;
                        if (name.includes('claude-3-5')) return 3;
                        if (name.includes('claude')) return 4;
                        if (name.includes('gpt-3.5')) return 5;
                        return 100;
                    };
                    return getWeight(a) - getWeight(b);
                });

                if (models.length === 0) models = result.data.map(m => m.id);

                this.modelSelect.innerHTML = models.map(id => `<option value="${id}">${id}</option>`).join('');
                
                const activeSession = this.getActiveSession();
                if (activeSession && activeSession.model && models.includes(activeSession.model)) {
                    this.modelSelect.value = activeSession.model;
                } else if (activeSession) {
                    activeSession.model = this.modelSelect.value;
                    this.saveData();
                }
                this.connectionStatus.textContent = 'CONNECTED';
            }
        } catch (error) {
            console.error('拉取 OpenAI 模型列表失败:', error);
            this.modelSelect.innerHTML = `
                <option value="gpt-4o">gpt-4o (推荐兜底)</option>
                <option value="gpt-4o-mini">gpt-4o-mini</option>
                <option value="gpt-4">gpt-4</option>
                <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
            `;
            const activeSession = this.getActiveSession();
            if (activeSession && activeSession.model) {
                this.modelSelect.value = activeSession.model;
            }
            this.connectionStatus.textContent = 'OFFLINE';
        }
    },

    renderPresets() {
        this.presetSelect.innerHTML = this.presets.map(p => 
            `<option value="${p.id}">${p.name}</option>`
        ).join('');
    },

    renderSessions() {
        this.sessionsTabs.innerHTML = this.sessions.map(s => {
            const isActive = s.id === this.activeSessionId ? 'active' : '';
            return `
                <button class="ai-session-tab ${isActive}" data-id="${s.id}">
                    ${this.escapeHTML(s.title)}
                </button>
            `;
        }).join('');

        this.sessionsTabs.querySelectorAll('.ai-session-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.switchSession(tab.getAttribute('data-id'));
            });
        });

        const activeSession = this.getActiveSession();
        if (activeSession) {
            this.activeSessionTitle.textContent = activeSession.title;
            this.presetSelect.value = activeSession.presetId;
            if (activeSession.model && this.modelSelect.querySelector(`option[value="${activeSession.model}"]`)) {
                this.modelSelect.value = activeSession.model;
            }
            this.renderMessages();
        }
    },

    renderMessages() {
        const activeSession = this.getActiveSession();
        if (!activeSession) return;

        this.chatBody.innerHTML = activeSession.messages.map(msg => {
            const meta = msg.role === 'user' ? 'YOU' : 'AI';
            const roleClass = msg.role;
            
            // 构建引用内容
            let quoteHTML = '';
            if (msg.quoteText) {
                quoteHTML = `<div class="chat-bubble-quote">“ ${this.escapeHTML(msg.quoteText)} ”</div>`;
            }

            // 对话版本切换 (仅 Assistant 且有多个版本时渲染)
            let versionSelectorHTML = '';
            if (msg.role === 'assistant' && msg.versions && msg.versions.length > 1) {
                const currentIdx = msg.activeVersionIndex + 1;
                const total = msg.versions.length;
                versionSelectorHTML = `
                    <div class="chat-version-selector">
                        <button class="btn-version-arrow" onclick="ChatManager.switchMessageVersion('${msg.id}', -1)">◂</button>
                        <span>${currentIdx} / ${total}</span>
                        <button class="btn-version-arrow" onclick="ChatManager.switchMessageVersion('${msg.id}', 1)">▸</button>
                    </div>
                `;
            }

                        // 悬浮工具栏 (包含：删除、引用、重新生成，以及生图草稿联动)
            const containsPrompt = this.detectPromptInText(msg.content);
            let importDraftHTML = '';
            if (containsPrompt) {
                // 提取干净的 Prompt 内容，并对双引号进行转义以防 HTML 破坏
                const cleanPromptVal = this.extractPromptText(msg.content)
                    .replace(/"/g, '&quot;')
                    .replace(/'/g, '&#039;');
                
                importDraftHTML = `
                    <button class="btn-action-mini" 
                            onclick="ChatManager.importToStudioDraft(this.getAttribute('data-prompt'))" 
                            data-prompt="${cleanPromptVal}" 
                            style="border: 1px solid var(--glass-border); background: var(--bg-card);">
                        导入草稿
                    </button>
                `;
            }

            const actionsHTML = `
                <div class="chat-message-actions">
                    ${importDraftHTML}
                    <button class="btn-action-mini" onclick="ChatManager.quoteMessage('${msg.id}')">引用</button>
                    ${msg.role === 'assistant' ? `<button class="btn-action-mini" onclick="ChatManager.reRollMessage('${msg.id}')">重试</button>` : ''}
                    <button class="btn-action-mini" onclick="ChatManager.deleteMessage('${msg.id}')" style="color: #e05e5e;">删除</button>
                </div>
            `;

            const formattedContent = this.renderMarkdown(msg.content);

            return `
                <div class="chat-bubble ${roleClass}" id="${msg.id}">
                    ${actionsHTML}
                    <span class="chat-bubble-meta">${meta}</span>
                    <div class="chat-bubble-content">
                        ${quoteHTML}
                        ${formattedContent}
                    </div>
                    ${versionSelectorHTML}
                </div>
            `;
        }).join('');

        this.scrollToBottom();
    },

    getActiveSession() {
        return this.sessions.find(s => s.id === this.activeSessionId);
    },

    createNewSession() {
        const id = `session_${Date.now()}`;
        const defaultPreset = this.presets[0] ? this.presets[0].id : 'chat';
        const presetName = this.presets[0] ? this.presets[0].name.split(' ')[0] : '会话';
        const num = this.sessions.length + 1;
        const newSession = {
            id,
            title: `窗口 ${num} (${presetName})`,
            presetId: defaultPreset,
            model: this.modelSelect.value || '',
            messages: [
                { id: `msg_init_${Date.now()}`, role: 'assistant', content: '新窗口已开启。你可以随时切换上方的预设身份，我会在此窗口中专注为你解答。', versions: ['新窗口已开启。你可以随时切换上方的预设身份，我会在此窗口中专注为你解答。'], activeVersionIndex: 0 }
            ]
        };

        this.sessions.push(newSession);
        this.activeSessionId = id;
        this.saveData();
        this.renderSessions();
    },

    switchSession(id) {
        if (this.sessions.some(s => s.id === id)) {
            this.activeSessionId = id;
            this.saveData();
            this.renderSessions();
        }
    },

    handlePresetChange(presetId) {
        const activeSession = this.getActiveSession();
        if (activeSession) {
            activeSession.presetId = presetId;
            const presetObj = this.presets.find(p => p.id === presetId);
            if (presetObj) {
                const rawTitle = activeSession.title.split(' (')[0];
                const cleanPresetName = presetObj.name.split(' [')[0];
                activeSession.title = `${rawTitle} (${cleanPresetName})`;
            }
            this.saveData();
            this.renderSessions();
        }
    },

    handleModelChange(modelId) {
        const activeSession = this.getActiveSession();
        if (activeSession) {
            activeSession.model = modelId;
            this.saveData();
        }
    },

    clearActiveSessionHistory() {
        const activeSession = this.getActiveSession();
        if (!activeSession) return;

        const confirmClear = confirm(`确定清空当前窗口【${activeSession.title}】内的所有聊天记录吗？`);
        if (confirmClear) {
            activeSession.messages = [
                { id: `msg_init_${Date.now()}`, role: 'assistant', content: '聊天记录已清空。我们可以重新开始探讨。', versions: ['聊天记录已清空。我们可以重新开始探讨。'], activeVersionIndex: 0 }
            ];
            this.saveData();
            this.renderMessages();
        }
    },

    deleteActiveSession() {
        if (this.sessions.length <= 1) {
            alert('系统必须保留至少一个聊天窗口。');
            return;
        }

        const activeSession = this.getActiveSession();
        const confirmDelete = confirm(`确定删除当前窗口【${activeSession.title}】吗？删除后会话记录将不可找回。`);
        
        if (confirmDelete) {
            this.sessions = this.sessions.filter(s => s.id !== this.activeSessionId);
            this.activeSessionId = this.sessions[0].id;
            this.saveData();
            this.renderSessions();
        }
    },

    // 触发引用特定消息
    quoteMessage(msgId) {
        const activeSession = this.getActiveSession();
        if (!activeSession) return;

        const targetMsg = activeSession.messages.find(m => m.id === msgId);
        if (!targetMsg) return;

        // 去除 Markdown 的简易显示字符
        let previewText = targetMsg.content.substring(0, 60);
        if (targetMsg.content.length > 60) previewText += '...';

        this.currentQuote = {
            id: msgId,
            text: targetMsg.content
        };

        // 显示引用预览栏
        this.quotePreviewText.textContent = previewText;
        this.quotePreviewBar.style.display = 'flex';
        this.chatInput.focus();
    },

    clearQuoteState() {
        this.currentQuote = null;
        this.quotePreviewBar.style.display = 'none';
        this.quotePreviewText.textContent = '';
    },

    // 删除单条特定消息
    deleteMessage(msgId) {
        const activeSession = this.getActiveSession();
        if (!activeSession) return;

        const index = activeSession.messages.findIndex(m => m.id === msgId);
        if (index === -1) return;

        const confirmDelete = confirm('确定要删除这条特定的消息吗？此操作无法撤销。');
        if (confirmDelete) {
            activeSession.messages.splice(index, 1);
            this.saveData();
            this.renderMessages();
        }
    },

    // 多版本切换 (Previous/Next)
    switchMessageVersion(msgId, direction) {
        const activeSession = this.getActiveSession();
        if (!activeSession) return;

        const msg = activeSession.messages.find(m => m.id === msgId);
        if (!msg || !msg.versions) return;

        let nextIdx = msg.activeVersionIndex + direction;
        if (nextIdx >= 0 && nextIdx < msg.versions.length) {
            msg.activeVersionIndex = nextIdx;
            msg.content = msg.versions[nextIdx];
            this.saveData();
            this.renderMessages();
        }
    },

    // 重构消息 (Re-roll)
    async reRollMessage(msgId) {
        const activeSession = this.getActiveSession();
        if (!activeSession) return;

        const msgIndex = activeSession.messages.findIndex(m => m.id === msgId);
        if (msgIndex === -1) return;

        const targetMsg = activeSession.messages[msgIndex];
        if (targetMsg.role !== 'assistant') return;

        const data = StorageManager.getData();
        const apiConfig = data.apiConfig;
        if (!apiConfig || !apiConfig.openaiKey) {
            alert('请先前往 [设置] 页面配置您的 OpenAI API Key。');
            return;
        }

        // 收集目标消息之前的上下文 (排除当前消息及其之后的所有消息)
        const priorMessages = activeSession.messages.slice(0, msgIndex);
        if (priorMessages.length === 0) return;

        // 渲染加载中动画状态
        const typingId = 'reroll_typing_' + Date.now();
        const typingBubble = document.createElement('div');
        typingBubble.className = 'chat-bubble assistant';
        typingBubble.id = typingId;
        typingBubble.innerHTML = `
            <span class="chat-bubble-meta">AI (重新生成中)</span>
            <div class="chat-bubble-content">
                <div class="typing-indicator">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        // 临时插入到被重试消息下方
        const targetElement = document.getElementById(msgId);
        if (targetElement) {
            targetElement.parentNode.insertBefore(typingBubble, targetElement.nextSibling);
            this.scrollToBottom();
        }

        // 组装系统 prompt
        const activePreset = this.presets.find(p => p.id === activeSession.presetId) || this.presets[0];
        const combinedSystemPrompt = this.buildSystemContext(activePreset.systemPrompt);

        const apiMessages = [
            { role: 'system', content: combinedSystemPrompt }
        ];

        // 截取最近 10 条前置上下文发送给大模型
        const historyLimit = 10;
        const startIdx = Math.max(0, priorMessages.length - historyLimit);
        for (let i = startIdx; i < priorMessages.length; i++) {
            apiMessages.push({
                role: priorMessages[i].role,
                content: priorMessages[i].content
            });
        }

        try {
            const response = await fetch(`${apiConfig.openaiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiConfig.openaiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: activeSession.model || this.modelSelect.value || 'gpt-4o',
                    messages: apiMessages,
                    temperature: 0.75 // 稍微提高随机性，得到不同的答案
                })
            });

            if (!response.ok) {
                const errDetail = await response.text();
                throw new Error(`HTTP ${response.status}: ${errDetail}`);
            }

            const responseData = await response.json();
            const newReply = responseData.choices[0].message.content;

            // 移除临时载入动画
            const typingElem = document.getElementById(typingId);
            if (typingElem) typingElem.remove();

            // 将新回复推入版本的数组
            if (!targetMsg.versions) {
                targetMsg.versions = [targetMsg.content];
            }
            targetMsg.versions.push(newReply);
            targetMsg.activeVersionIndex = targetMsg.versions.length - 1;
            targetMsg.content = newReply;

            this.saveData();
            this.renderMessages();

        } catch (error) {
            console.error('重试消息生成失败:', error);
            const typingElem = document.getElementById(typingId);
            if (typingElem) typingElem.remove();

            alert(`重试失败: ${error.message}`);
        }
    },

    buildSystemContext(systemPrompt) {
        const data = StorageManager.getData();
        const memos = data.memos || [];
        const todos = data.todos || [];

        let contextText = `\n\n=== [当前用户的项目创作上下文] ===\n`;

        if (memos.length > 0) {
            contextText += `[最新备忘录记录 (脑洞想法)]:\n`;
            memos.slice(0, 10).forEach((memo, idx) => {
                contextText += `${idx + 1}. 主题: ${memo.title || '无标题'}\n内容: ${memo.content || ''}\n`;
            });
        } else {
            contextText += `[当前无备忘录数据]\n`;
        }

        if (todos.length > 0) {
            contextText += `\n[最新待办事项进度列表]:\n`;
            const pending = todos.filter(t => t.status === 'pending');
            const active = todos.filter(t => t.status === 'active');
            const completed = todos.filter(t => t.status === 'completed');

            if (pending.length > 0) {
                contextText += `- 待办 (Pending):\n` + pending.map(t => `  * ${t.text}`).join('\n') + `\n`;
            }
            if (active.length > 0) {
                contextText += `- 进行中 (In Progress):\n` + active.map(t => `  * ${t.text}`).join('\n') + `\n`;
            }
            if (completed.length > 0) {
                contextText += `- 已完成 (Completed):\n` + completed.map(t => `  * ${t.text}`).join('\n') + `\n`;
            }
        } else {
            contextText += `\n[当前无待办任务]\n`;
        }
        
        contextText += `=========================================================================\n`;

        return `${systemPrompt}${contextText}`;
    },

    async sendMessage() {
        const text = this.chatInput.value.trim();
        if (!text) return;

        const activeSession = this.getActiveSession();
        if (!activeSession) return;

        const data = StorageManager.getData();
        const apiConfig = data.apiConfig;
        if (!apiConfig || !apiConfig.openaiKey) {
            alert('请先前往 [设置] 页面配置您的 OpenAI API Key。');
            return;
        }

        // 组装新发送的消息数据结构
        const msgId = 'msg_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        const newMsgObj = { 
            id: msgId, 
            role: 'user', 
            content: text 
        };

        // 如果存在当前引用，则附加引用信息并清除引用状态
        if (this.currentQuote) {
            newMsgObj.quoteId = this.currentQuote.id;
            newMsgObj.quoteText = this.currentQuote.text;
            this.clearQuoteState();
        }

        activeSession.messages.push(newMsgObj);
        this.chatInput.value = '';
        this.renderMessages();
        this.saveData();

        const typingId = 'typing_' + Date.now();
        const typingBubble = document.createElement('div');
        typingBubble.className = 'chat-bubble assistant';
        typingBubble.id = typingId;
        typingBubble.innerHTML = `
            <span class="chat-bubble-meta">AI</span>
            <div class="chat-bubble-content">
                <div class="typing-indicator">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        this.chatBody.appendChild(typingBubble);
        this.scrollToBottom();

        const activePreset = this.presets.find(p => p.id === activeSession.presetId) || this.presets[0];
        const combinedSystemPrompt = this.buildSystemContext(activePreset.systemPrompt);

        const apiMessages = [
            { role: 'system', content: combinedSystemPrompt }
        ];

        const historyLimit = 10;
        const startIdx = Math.max(0, activeSession.messages.length - historyLimit);
        for (let i = startIdx; i < activeSession.messages.length; i++) {
            apiMessages.push({
                role: activeSession.messages[i].role,
                content: activeSession.messages[i].content
            });
        }

        try {
            const response = await fetch(`${apiConfig.openaiUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiConfig.openaiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: activeSession.model || this.modelSelect.value || 'gpt-4o',
                    messages: apiMessages,
                    temperature: 0.7
                })
            });

            if (!response.ok) {
                const errDetail = await response.text();
                throw new Error(`HTTP ${response.status}: ${errDetail}`);
            }

            const responseData = await response.json();
            const aiReply = responseData.choices[0].message.content;

            const typingElem = document.getElementById(typingId);
            if (typingElem) typingElem.remove();

            const assistantMsgId = 'msg_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
            activeSession.messages.push({ 
                id: assistantMsgId,
                role: 'assistant', 
                content: aiReply,
                versions: [aiReply],
                activeVersionIndex: 0
            });
            
            this.saveData();
            this.renderMessages();

        } catch (error) {
            console.error('AI 响应失败:', error);
            const typingElem = document.getElementById(typingId);
            if (typingElem) typingElem.remove();

            const errId = 'msg_err_' + Date.now();
            activeSession.messages.push({ 
                id: errId,
                role: 'assistant', 
                content: `通信异常：生成消息失败。请检查 [设置] 中的 API 地址与密钥配置。\n[错误日志]: ${error.message}`,
                versions: [`通信异常：生成消息失败。请检查 [设置] 中的 API 地址与密钥配置。\n[错误日志]: ${error.message}`],
                activeVersionIndex: 0
            });
            this.saveData();
            this.renderMessages();
        }
    },

    renderMarkdown(text) {
        let html = this.escapeHTML(text);

        // 渲染多行代码块 ```code```
        html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
            return `<pre><code>${code.trim()}</code></pre>`;
        });

        // 渲染单行代码 `code`
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 渲染段落
        html = html.split('\n\n').map(p => {
            if (p.trim().startsWith('- ')) {
                const listItems = p.split('\n').map(li => {
                    if (li.trim().startsWith('- ')) {
                        return `<li>${li.trim().substring(2)}</li>`;
                    }
                    return li;
                }).join('');
                return `<ul>${listItems}</ul>`;
            }
            return `<p>${p.replace(/\n/g, '<br>')}</p>`;
        }).join('');

        return html;
    },

    escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

       scrollToBottom() {
        this.chatBody.scrollTop = this.chatBody.scrollHeight;
    },

    /**
     * 检测文本中是否可能包含生图提示词特征
     */
    detectPromptInText(text) {
        if (!text) return false;
        
        // 1. 如果被 markdown 代码块包裹，且代码块包含常见的 tag
        if (text.includes('```')) {
            const codeBlocks = text.match(/```([\s\S]*?)```/g);
            if (codeBlocks) {
                for (const block of codeBlocks) {
                    if (block.includes(',') && (block.includes('girl') || block.includes('boy') || block.includes('quality') || block.includes('masterpiece'))) {
                        return true;
                    }
                }
            }
        }

        // 2. 如果包含连续以英文逗号分隔的多达 4 个及以上的 Danbooru tags
        const commaCount = (text.match(/,/g) || []).length;
        if (commaCount >= 4 && (text.toLowerCase().includes('masterpiece') || text.toLowerCase().includes('detailed') || text.toLowerCase().includes('1girl') || text.toLowerCase().includes('quality'))) {
            return true;
        }

        return false;
    },

    /**
     * 提取干净的 Prompt 文本
     */
    extractPromptText(text) {
        if (!text) return '';

        // 优先提取 markdown 代码块中的内容
        const codeBlockRegex = /```(?:[a-zA-Z]*)\n([\s\S]*?)```/g;
        const match = codeBlockRegex.exec(text);
        if (match && match[1]) {
            return match[1].trim();
        }

        // 否则尝试按逗号行的最大集聚块提取，过滤掉解释性自然语言
        const lines = text.split('\n');
        let bestLine = '';
        let maxCommas = 0;
        for (const line of lines) {
            const count = (line.match(/,/g) || []).length;
            if (count > maxCommas) {
                maxCommas = count;
                bestLine = line;
            }
        }

        if (maxCommas >= 3) {
            return bestLine.trim();
        }

        return text.trim();
    },

    /**
     * 将提示词一键导入生图工作室草稿箱，并切换 SPA 路由
     */
    importToStudioDraft(promptVal) {
        if (!promptVal) return;

        // 1. 读取当前的生图草稿箱数据
        let drafts = [];
        try {
            drafts = JSON.parse(localStorage.getItem('studio_generator_drafts')) || [];
        } catch (e) {
            drafts = [];
        }

        // 2. 创建新草稿对象
        const draftId = 'draft_' + Date.now();
        const num = drafts.length + 1;
        const newDraft = {
            id: draftId,
            name: `AI 导入草稿 ${num}`,
            prompt: promptVal,
            negativePrompt: 'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry',
            targetBackend: 'novelai', // 默认设为 NovelAI 后端
            artists: [],
            params: {
                width: 832,
                height: 1216,
                steps: 28,
                scale: 5.0,
                sampler: 'k_euler',
                seed: -1,
                model: 'nai-diffusion-4-5-full', // 使用预设下拉首选模型
                smea: false,
                smeaDyn: false,
                vibeBase64: null,
                vibeStrength: 0.6,
                manualArtists: ''
            }
        };

        // 3. 追加并存入 LocalStorage
        drafts.push(newDraft);
        localStorage.setItem('studio_generator_drafts', JSON.stringify(drafts));
        localStorage.setItem('studio_workbench_active_draft_id', draftId);

        // 4. 通知并切换 SPA 路由至“生图工作室”面板
        alert("已成功新建生成草稿并导入提示词！正在跳转至生图面板...");

        // 激活生图主菜单项
        const studioNavItem = document.querySelector('.nav-item[data-target="studio"]');
        if (studioNavItem) {
            studioNavItem.click();
        }

        // 触发 Studio 刷新机制以载入刚才新存入的草稿
        if (window.StudioManager && typeof window.StudioManager.init === 'function') {
            window.StudioManager.init(); // 重新加载数据并重绘标签页
        }
    }
};


// 页面加载后自动启动，挂载至全局
document.addEventListener('DOMContentLoaded', () => {
    ChatManager.init();
    window.ChatManager = ChatManager;
});
