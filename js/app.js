document.addEventListener('DOMContentLoaded', () => {
    // 页面跳转逻辑 (SPA)
    const navItems = document.querySelectorAll('.nav-item');
    const panes = document.querySelectorAll('.pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            navItems.forEach(i => i.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            item.classList.add('active');
            const targetId = `pane-${item.getAttribute('data-target')}`;
            document.getElementById(targetId).classList.add('active');
        });
    });

    // AI 助手栏展开与折叠
    const aiToggleBtn = document.getElementById('ai-toggle-btn');
    const aiSidebar = document.getElementById('ai-sidebar');
    const aiCloseBtn = document.getElementById('ai-close-btn');

    if (aiToggleBtn && aiSidebar && aiCloseBtn) {
        aiToggleBtn.addEventListener('click', () => {
            aiSidebar.classList.add('open');
        });

        aiCloseBtn.addEventListener('click', () => {
            aiSidebar.classList.remove('open');
        });
    }

    // 主题切换管理
    const themeSelector = document.getElementById('theme-selector');
    const currentData = StorageManager.getData();
    const savedTheme = currentData.theme || 'light';
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeSelector.value = savedTheme;

    themeSelector.addEventListener('change', (e) => {
        const selectedTheme = e.target.value;
        document.documentElement.setAttribute('data-theme', selectedTheme);
        StorageManager.updateKey('theme', selectedTheme);
    });

    // 填充 API 配置初始值
    const inputOpenaiUrl = document.getElementById('input-openai-url');
    const inputOpenaiKey = document.getElementById('input-openai-key');
    const inputNovelaiUrl = document.getElementById('input-novelai-url');
    const inputNovelaiKey = document.getElementById('input-novelai-key');
    const inputSdUrl = document.getElementById('input-sd-url');
    const inputCorsProxy = document.getElementById('input-cors-proxy');
    const btnSaveApiConfig = document.getElementById('btn-save-api-config');

    if (currentData.apiConfig) {
        if (inputOpenaiUrl) inputOpenaiUrl.value = currentData.apiConfig.openaiUrl || '';
        if (inputOpenaiKey) inputOpenaiKey.value = currentData.apiConfig.openaiKey || '';
        if (inputNovelaiUrl) inputNovelaiUrl.value = currentData.apiConfig.novelaiUrl || '';
        if (inputNovelaiKey) inputNovelaiKey.value = currentData.apiConfig.novelaiKey || '';
        if (inputSdUrl) inputSdUrl.value = currentData.apiConfig.sdUrl || '';
        if (inputCorsProxy) inputCorsProxy.value = currentData.apiConfig.corsProxy || '';
    }

    // 保存 API 凭证
    if (btnSaveApiConfig) {
        btnSaveApiConfig.addEventListener('click', async () => {
            const data = StorageManager.getData();
            data.apiConfig = {
                openaiUrl: inputOpenaiUrl.value.trim(),
                openaiKey: inputOpenaiKey.value.trim(),
                novelaiUrl: inputNovelaiUrl.value.trim(),
                novelaiKey: inputNovelaiKey.value.trim(),
                sdUrl: inputSdUrl.value.trim(),
                corsProxy: inputCorsProxy.value.trim()
            };
            StorageManager.save(data);
            
            // 同步触发 AI 助手大模型列表拉取
            if (window.ChatManager && typeof window.ChatManager.fetchModels === 'function') {
                await window.ChatManager.fetchModels();
            }
            
            alert('配置保存成功，所有配置均已安全存储在浏览器本地。');
        });
    }

    // --- 自定义 AI 身份预设管理器逻辑 ---
    const presetListContainer = document.getElementById('preset-manager-list');
    const inputNewPresetName = document.getElementById('input-new-preset-name');
    const inputNewPresetPrompt = document.getElementById('input-new-preset-prompt');
    const btnAddCustomPreset = document.getElementById('btn-add-custom-preset');

    // 渲染设置面板中的预设列表
    function renderPresetManagerList() {
        if (!presetListContainer) return;
        const data = StorageManager.getData();
        const presets = data.aiPresets || [];

        presetListContainer.innerHTML = presets.map(p => {
            const typeLabel = p.isSystem ? '内置预设' : '自定义';
            const deleteBtn = p.isSystem 
                ? `<span style="font-size:0.7rem; color:var(--text-muted);">系统锁</span>` 
                : `<button class="btn-text-danger btn-mini btn-delete-preset" data-id="${p.id}">删除</button>`;
            
            return `
                <div class="preset-manager-item">
                    <div class="preset-info">
                        <span class="preset-info-name">${escapeHTML(p.name)}</span>
                        <span class="preset-info-type">${typeLabel}</span>
                    </div>
                    <div>
                        ${deleteBtn}
                    </div>
                </div>
            `;
        }).join('');

        // 绑定删除自定义预设事件
        presetListContainer.querySelectorAll('.btn-delete-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idToDelete = e.target.getAttribute('data-id');
                deleteCustomPreset(idToDelete);
            });
        });
    }

    // 新增预设
    if (btnAddCustomPreset) {
        btnAddCustomPreset.addEventListener('click', () => {
            const name = inputNewPresetName.value.trim();
            const prompt = inputNewPresetPrompt.value.trim();

            if (!name || !prompt) {
                alert('请填写完整的显示名称与指令设定。');
                return;
            }

            // 过滤 emoji 安全限制 (非聊天消息防报错)
            const cleanName = removeEmojis(name);
            const cleanPrompt = removeEmojis(prompt);

            const data = StorageManager.getData();
            const newPreset = {
                id: `preset_custom_${Date.now()}`,
                name: cleanName,
                systemPrompt: cleanPrompt,
                isSystem: false
            };

            data.aiPresets.push(newPreset);
            StorageManager.save(data);

            inputNewPresetName.value = '';
            inputNewPresetPrompt.value = '';

            renderPresetManagerList();
            
            // 同步通知 AI 侧边栏刷新预设下拉菜单
            if (window.ChatManager && typeof window.ChatManager.loadData === 'function') {
                window.ChatManager.loadData();
                window.ChatManager.renderPresets();
            }

            alert('自定义身份预设保存成功。');
        });
    }

    // 删除自定义预设
    function deleteCustomPreset(id) {
        const confirmDelete = confirm('确定要删除这个自定义预设吗？');
        if (!confirmDelete) return;

        const data = StorageManager.getData();
        data.aiPresets = data.aiPresets.filter(p => p.id !== id);
        
        // 兼容处理：若当前有会话正处于被删除的预设上，则将其回退为 'chat' (默认预设)
        if (data.chatSessions) {
            data.chatSessions.forEach(s => {
                if (s.presetId === id) s.presetId = 'chat';
            });
        }

        StorageManager.save(data);
        renderPresetManagerList();

        // 同步通知 AI 侧边栏
        if (window.ChatManager && typeof window.ChatManager.loadData === 'function') {
            window.ChatManager.loadData();
            window.ChatManager.renderPresets();
            window.ChatManager.renderSessions(); // 刷新会话名与选项
        }
    }

    function escapeHTML(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function removeEmojis(str) {
        const emojiReg = /[\u{1F300}-\u{1F9FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F191}-\u{1F251}]|[\u{1F004}]|[\u{1F0CF}]|[\u{1F900}-\u{1F9FF}]|[\u{1F300}-\u{1F5FF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{2600}-\u{27BF}]|[\u{1F1E6}-\u{1F1FF}]|[\u{1F191}-\u{1F251}]/gu;
        return str.replace(emojiReg, '');
    }

    // 初始化渲染设置中的预设管理器
    renderPresetManagerList();

    // 数据导入与导出交互
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImportInput = document.getElementById('file-import');
    const btnResetData = document.getElementById('btn-reset-data');

    if (btnExport) {
        btnExport.addEventListener('click', () => {
            StorageManager.exportData();
        });
    }

    if (btnImportTrigger) {
        btnImportTrigger.addEventListener('click', () => {
            fileImportInput.click();
        });
    }

    if (fileImportInput) {
        fileImportInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                StorageManager.importData(file, (success, errorMsg) => {
                    if (success) {
                        alert("数据导入成功，页面即将刷新...");
                        window.location.reload();
                    } else {
                        alert(`导入失败: ${errorMsg}`);
                    }
                });
            }
        });
    }

    // 一键格式化清空数据
    if (btnResetData) {
        btnResetData.addEventListener('click', () => {
            const confirmFirst = confirm("警告：此操作将永久清空本地存储的所有提示词书、备忘录和API Key配置！\n确定要格式化工作台吗？");
            if (confirmFirst) {
                const confirmSecond = confirm("请再次确认，这会导致所有本地数据丢失且不可找回。输入确定开始格式化。");
                if (confirmSecond) {
                    StorageManager.resetData();
                    alert("工作台已格式化恢复至初始状态。");
                    window.location.reload();
                }
            }
        });
    }

    // 教程指南浮窗模态框打开与关闭
    const guideModal = document.getElementById('guide-modal');
    const btnCloseGuide = document.getElementById('btn-close-guide');
    const guideTriggers = document.querySelectorAll('.btn-guide-trigger');

    if (guideModal && btnCloseGuide) {
        guideTriggers.forEach(btn => {
            btn.addEventListener('click', () => {
                guideModal.classList.add('active');
            });
        });

        btnCloseGuide.addEventListener('click', () => {
            guideModal.classList.remove('active');
        });

        // 点击空白处关闭
        guideModal.addEventListener('click', (e) => {
            if (e.target === guideModal) {
                guideModal.classList.remove('active');
            }
        });
    }
});
