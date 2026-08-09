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

    aiToggleBtn.addEventListener('click', () => {
        aiSidebar.classList.add('open');
    });

    aiCloseBtn.addEventListener('click', () => {
        aiSidebar.classList.remove('open');
    });

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
    const inputNovelaiKey = document.getElementById('input-novelai-key');
    const inputCorsProxy = document.getElementById('input-cors-proxy');
    const btnSaveApiConfig = document.getElementById('btn-save-api-config');

    if (currentData.apiConfig) {
        inputOpenaiUrl.value = currentData.apiConfig.openaiUrl || '';
        inputOpenaiKey.value = currentData.apiConfig.openaiKey || '';
        inputNovelaiKey.value = currentData.apiConfig.novelaiKey || '';
        inputCorsProxy.value = currentData.apiConfig.corsProxy || '';
    }

    // 保存 API 凭证
    btnSaveApiConfig.addEventListener('click', () => {
        const data = StorageManager.getData();
        data.apiConfig = {
            openaiUrl: inputOpenaiUrl.value.trim(),
            openaiKey: inputOpenaiKey.value.trim(),
            novelaiKey: inputNovelaiKey.value.trim(),
            corsProxy: inputCorsProxy.value.trim()
        };
        StorageManager.save(data);
        alert('配置保存成功，所有密钥均已加密存储在本地。');
    });

    // 数据导入与导出交互
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImportInput = document.getElementById('file-import');
    const btnResetData = document.getElementById('btn-reset-data');

    btnExport.addEventListener('click', () => {
        StorageManager.exportData();
    });

    btnImportTrigger.addEventListener('click', () => {
        fileImportInput.click();
    });

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

    // 一键格式化清空数据
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
});
