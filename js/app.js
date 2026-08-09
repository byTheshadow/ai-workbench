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

    // 填充 API 配置初始值 (升级版：含 NovelAI Url、第三方生图 API 地址)
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

    // 保存 API 凭证 (包含全部生图接口)
    if (btnSaveApiConfig) {
        btnSaveApiConfig.addEventListener('click', async () => {
            const data = StorageManager.getData();
            data.apiConfig = {
                openaiUrl: inputOpenaiUrl.value.trim(),
                openaiKey: inputOpenaiKey.value.trim(),
                novelaiUrl: inputNovelaiUrl.value.trim(),
                novelaiKey: inputNovelaiKey.value.trim(),
                sdUrl: inputSdUrl.value.trim(), // 第三方生图 API (如 WebUI / ComfyUI)
                corsProxy: inputCorsProxy.value.trim()
            };
            StorageManager.save(data);
            
            // 保存后自动触发 AI 助手更新大模型列表
            if (window.ChatManager && typeof window.ChatManager.fetchModels === 'function') {
                await window.ChatManager.fetchModels();
            }
            
            alert('配置保存成功，所有配置均已安全存储在浏览器本地。');
        });
    }

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
