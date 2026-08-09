document.addEventListener('DOMContentLoaded', () => {
    // 数据模型中的分类映射表
    const categoryNameMapping = {
        style: '风格前置',
        expression: '表情',
        character: '角色',
        outfit: '服装',
        artistsCombo: '画师串',
        artistsSolo: '画师单独',
        scenery: '场景'
    };

    let currentCategoryKey = 'style'; // 默认为第一个分类
    let isEditingMode = false;

    // DOM 元素声明
    const categoryTabs = document.getElementById('category-tabs');
    const promptsGrid = document.getElementById('prompts-grid');
    const currentCategoryTitle = document.getElementById('current-category-title');
    const globalPromptBuffer = document.getElementById('global-prompt-buffer');
    const btnClearAccumulator = document.getElementById('btn-clear-accumulator');
    
    // 模态框相关 DOM
    const promptModal = document.getElementById('prompt-modal');
    const modalTitle = document.getElementById('modal-title');
    const btnCloseModal = document.getElementById('btn-close-modal');
    const btnSavePrompt = document.getElementById('btn-save-prompt');
    const btnDeletePrompt = document.getElementById('btn-delete-prompt');
    const btnAddPrompt = document.getElementById('btn-add-prompt');
    const btnAddCategory = document.getElementById('btn-add-category');
    
    // 输入框 DOM
    const editPromptId = document.getElementById('edit-prompt-id');
    const inputPromptName = document.getElementById('input-prompt-name');
    const inputPromptContent = document.getElementById('input-prompt-content');
    const inputPromptRemark = document.getElementById('input-prompt-remark');
    const groupPromptRemark = document.getElementById('group-prompt-remark');

    // 1. 初始化分类列表
    function renderCategories() {
        const data = StorageManager.getData();
        categoryTabs.innerHTML = '';

        // 渲染内置分类
        Object.keys(categoryNameMapping).forEach(key => {
            createTabButton(key, categoryNameMapping[key]);
        });

        // 渲染用户自定义分类
        if (data.prompts.custom) {
            Object.keys(data.prompts.custom).forEach(key => {
                createTabButton(`custom_${key}`, key);
            });
        }
    }

    function createTabButton(key, displayName) {
        const btn = document.createElement('button');
        btn.classList.add('tab-btn');
        if (key === currentCategoryKey) btn.classList.add('active');
        btn.textContent = displayName;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategoryKey = key;
            renderPrompts();
        });
        categoryTabs.appendChild(btn);
    }

    // 2. 渲染提示词网格
    function renderPrompts() {
        const data = StorageManager.getData();
        promptsGrid.innerHTML = '';

        // 决定显示的名字
        let displayTitle = '';
        let list = [];

        if (currentCategoryKey.startsWith('custom_')) {
            const customKey = currentCategoryKey.replace('custom_', '');
            displayTitle = customKey;
            list = data.prompts.custom[customKey] || [];
        } else {
            displayTitle = categoryNameMapping[currentCategoryKey];
            list = data.prompts.presets[currentCategoryKey] || [];
        }

        currentCategoryTitle.textContent = displayTitle;

        if (list.length === 0) {
            promptsGrid.innerHTML = '<p class="placeholder-text">暂无词条，请点击添加词条。</p>';
            return;
        }

        list.forEach(item => {
            const card = document.createElement('div');
            card.classList.add('prompt-card');
            
            // 点击直接插入暂存区
            card.addEventListener('click', (e) => {
                // 如果点中编辑按钮，不触发卡片点击
                if (e.target.closest('.btn-card-edit')) return;
                appendPrompt(item.content);
            });

            // 卡片内部 HTML
            let remarkHtml = item.remark ? `<div class="prompt-remark">${escapeHtml(item.remark)}</div>` : '';
            card.innerHTML = `
                <div class="prompt-card-content">
                    <div class="prompt-name">${escapeHtml(item.name)}</div>
                    <div class="prompt-val">${escapeHtml(item.content)}</div>
                    ${remarkHtml}
                </div>
                <div class="prompt-card-actions">
                    <button class="btn-card-edit" data-id="${item.id}">
                        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                    </button>
                </div>
            `;
            
            // 给卡片内的编辑按钮绑定事件
            card.querySelector('.btn-card-edit').addEventListener('click', () => {
                openEditModal(item);
            });

            promptsGrid.appendChild(card);
        });
    }

    // 安全字符过滤
    function escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // 3. 提示词缓存追加逻辑
    function appendPrompt(text) {
        let currentText = globalPromptBuffer.value.trim();
        if (currentText === '') {
            globalPromptBuffer.value = text;
        } else {
            // 如果原本末尾没有逗号，则补充一个逗号
            if (!currentText.endsWith(',')) {
                globalPromptBuffer.value = currentText + ', ' + text;
            } else {
                globalPromptBuffer.value = currentText + ' ' + text;
            }
        }
    }

    btnClearAccumulator.addEventListener('click', () => {
        globalPromptBuffer.value = '';
    });

    // 4. 新建/编辑交互
    function openEditModal(item = null) {
        if (item) {
            isEditingMode = true;
            modalTitle.textContent = "编辑词条";
            editPromptId.value = item.id;
            inputPromptName.value = item.name;
            inputPromptContent.value = item.content;
            inputPromptRemark.value = item.remark || '';
            btnDeletePrompt.style.display = 'block';
        } else {
            isEditingMode = false;
            modalTitle.textContent = "新建词条";
            editPromptId.value = '';
            inputPromptName.value = '';
            inputPromptContent.value = '';
            inputPromptRemark.value = '';
            btnDeletePrompt.style.display = 'none';
        }

        // 仅在“画师串”或自定义分类显示备注输入框
        if (currentCategoryKey === 'artistsCombo' || currentCategoryKey.startsWith('custom_')) {
            groupPromptRemark.style.display = 'flex';
        } else {
            groupPromptRemark.style.display = 'none';
        }

        promptModal.classList.add('open');
    }

    function closeModal() {
        promptModal.classList.remove('open');
    }

    btnCloseModal.addEventListener('click', closeModal);
    btnAddPrompt.addEventListener('click', () => openEditModal(null));

    // 5. 保存数据 (支持修改和新增)
    btnSavePrompt.addEventListener('click', () => {
        const name = inputPromptName.value.trim();
        const content = inputPromptContent.value.trim();
        const remark = inputPromptRemark.value.trim();

        if (!name || !content) {
            alert('名称和提示词内容不能为空');
            return;
        }

        const data = StorageManager.getData();
        let listRef;

        // 获取当前操作的数组引用
        if (currentCategoryKey.startsWith('custom_')) {
            const customKey = currentCategoryKey.replace('custom_', '');
            if (!data.prompts.custom[customKey]) data.prompts.custom[customKey] = [];
            listRef = data.prompts.custom[customKey];
        } else {
            if (!data.prompts.presets[currentCategoryKey]) data.prompts.presets[currentCategoryKey] = [];
            listRef = data.prompts.presets[currentCategoryKey];
        }

        if (isEditingMode) {
            // 更新操作
            const targetId = editPromptId.value;
            const targetIndex = listRef.findIndex(item => item.id === targetId);
            if (targetIndex !== -1) {
                listRef[targetIndex] = { ...listRef[targetIndex], name, content, remark };
            }
        } else {
            // 新增操作
            const newPrompt = {
                id: 'p_' + Date.now(),
                name,
                content,
                remark: (currentCategoryKey === 'artistsCombo' || currentCategoryKey.startsWith('custom_')) ? remark : undefined
            };
            listRef.push(newPrompt);
        }

        // 回写本地存储并重绘
        StorageManager.save(data);
        closeModal();
        renderPrompts();
    });

    // 6. 删除数据
    btnDeletePrompt.addEventListener('click', () => {
        if (!confirm('确定要删除这个词条吗？')) return;
        
        const data = StorageManager.getData();
        const targetId = editPromptId.value;
        let listRef;

        if (currentCategoryKey.startsWith('custom_')) {
            const customKey = currentCategoryKey.replace('custom_', '');
            listRef = data.prompts.custom[customKey];
        } else {
            listRef = data.prompts.presets[currentCategoryKey];
        }

        const targetIndex = listRef.findIndex(item => item.id === targetId);
        if (targetIndex !== -1) {
            listRef.splice(targetIndex, 1);
            StorageManager.save(data);
        }

        closeModal();
        renderPrompts();
    });

    // 7. 新建分类功能
    btnAddCategory.addEventListener('click', () => {
        const categoryName = prompt('请输入新分类的名称:');
        if (!categoryName) return;
        const cleanName = categoryName.trim();
        if (cleanName === '') return;

        const data = StorageManager.getData();
        
        // 避开内置分类名称冲突
        if (categoryNameMapping[cleanName] || data.prompts.custom[cleanName]) {
            alert('分类名称已存在');
            return;
        }

        if (!data.prompts.custom) data.prompts.custom = {};
        data.prompts.custom[cleanName] = [];
        StorageManager.save(data);

        // 设置当前活动标签为新分类，并重新渲染
        currentCategoryKey = `custom_${cleanName}`;
        renderCategories();
        renderPrompts();
    });

    // --- 执行初次启动渲染 ---
    renderCategories();
    renderPrompts();
});
