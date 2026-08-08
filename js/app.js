document.addEventListener('DOMContentLoaded', () => {
    // 页面跳转逻辑 (SPA)
    const navItems = document.querySelectorAll('.nav-item');
    const panes = document.querySelectorAll('.pane');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // 清理状态
            navItems.forEach(i => i.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));

            // 激活当前
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
    
    // 初始化应用主题
    const currentData = StorageManager.getData();
    const savedTheme = currentData.theme || 'light';
    
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeSelector.value = savedTheme;

    themeSelector.addEventListener('change', (e) => {
        const selectedTheme = e.target.value;
        document.documentElement.setAttribute('data-theme', selectedTheme);
        StorageManager.updateKey('theme', selectedTheme);
    });

    // 数据导入与导出交互
    const btnExport = document.getElementById('btn-export');
    const btnImportTrigger = document.getElementById('btn-import-trigger');
    const fileImportInput = document.getElementById('file-import');

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
});
