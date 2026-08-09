document.addEventListener('DOMContentLoaded', () => {
    const categoryNameMapping = {
        style: '风格前置',
        expression: '表情',
        character: '角色',
        outfit: '服装',
        artistsCombo: '画师串',
        artistsSolo: '画师单独',
        scenery: '场景'
    };

    let currentCategoryKey = 'style'; 
    let isEditingMode = false;
    let searchQuery = '';

    // DOM 元素声明
    const categoryTabs = document.getElementById('category-tabs');
    const promptsGrid = document.getElementById('prompts-grid');
    const currentCategoryTitle = document.getElementById('current-category-title');
    const globalPromptBuffer = document.getElementById('global-prompt-buffer');
    const btnClearAccumulator = document.getElementById('btn-clear-accumulator');
    const btnDeleteCategory = document.getElementById('btn-delete-category');
    const inputPromptSearch = document.getElementById('input-prompt-search');
    
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

    // 1. 初始化与渲染分类列表
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

        // 检查是否显示“删除分类”按钮 (只在自定义分类下显示)
        if (currentCategoryKey.startsWith('custom_')) {
            btnDeleteCategory.style.display = 'inline-flex';
        } else {
            btnDeleteCategory.style.display = 'none';
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
            inputPromptSearch.value = ''; // 切换分类清空搜索词
            searchQuery = '';
            
            if (currentCategoryKey.startsWith('custom_')) {
                btnDeleteCategory.style.display = 'inline-flex';
            } else {
                btnDeleteCategory.style.display = 'none';
            }
            renderPrompts();
        });
        categoryTabs.appendChild(btn);
    }

    // 2. 渲染提示词网格
    function renderPrompts() {
        const data = StorageManager.getData();
        promptsGrid.innerHTML = '';

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

        // 根据搜索关键词进行前端实时过滤
        const filteredList = list.filter(item => {
            if (!searchQuery) return true;
            const searchLower = searchQuery.toLowerCase();
            const nameMatch = item.name && item.name.toLowerCase().includes(searchLower);
            const contentMatch = item.content && item.content.toLowerCase().includes(searchLower);
            const remarkMatch = item.remark && item.remark.toLowerCase().includes(searchLower);
            return nameMatch || contentMatch || remarkMatch;
        });

        if (filteredList.length === 0) {
            promptsGrid.innerHTML = '<p class="placeholder-text">没有找到匹配的词条。</p>';
            return;
        }

        filteredList.forEach(item => {
            const card = document.createElement('div');
            card.classList.add('prompt-card');
            
            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-card-edit')) return;
                appendPrompt(item.content);
            });

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
            
            card.querySelector('.btn-card-edit').addEventListener('click', () => {
                openEditModal(item);
            });

            promptsGrid.appendChild(card);
        });
    }

    function escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // 3. 提示词缓冲区逻辑
    function appendPrompt(text) {
        let currentText = globalPromptBuffer.value.trim();
        if (currentText === '') {
            globalPromptBuffer.value = text;
        } else {
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

    // 4. 实时搜索监听
    inputPromptSearch.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderPrompts();
    });

    // 5. 模态框打开与关闭
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

    // 6. 保存提示词
    btnSavePrompt.addEventListener('click', () => {
        const name = inputPromptName.value.trim();
        const content = inputPromptContent.value.trim();
        const remark = inputPromptRemark.value.trim();

        if (!name || !content) {
            alert('名称和内容不能为空');
            return;
        }

        const data = StorageManager.getData();
        let listRef;

        if (currentCategoryKey.startsWith('custom_')) {
            const customKey = currentCategoryKey.replace('custom_', '');
            if (!data.prompts.custom[customKey]) data.prompts.custom[customKey] = [];
            listRef = data.prompts.custom[customKey];
        } else {
            if (!data.prompts.presets[currentCategoryKey]) data.prompts.presets[currentCategoryKey] = [];
            listRef = data.prompts.presets[currentCategoryKey];
        }

        if (isEditingMode) {
            const targetId = editPromptId.value;
            const targetIndex = listRef.findIndex(item => item.id === targetId);
            if (targetIndex !== -1) {
                listRef[targetIndex] = { ...listRef[targetIndex], name, content, remark };
            }
        } else {
            const newPrompt = {
                id: 'p_' + Date.now(),
                name,
                content,
                remark: (currentCategoryKey === 'artistsCombo' || currentCategoryKey.startsWith('custom_')) ? remark : undefined
            };
            listRef.push(newPrompt);
        }

        StorageManager.save(data);
        closeModal();
        renderPrompts();
    });

    // 7. 删除词条
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

    // 8. 自定义分类创建与删除
    btnAddCategory.addEventListener('click', () => {
        const categoryName = prompt('请输入新分类的名称:');
        if (!categoryName) return;
        const cleanName = categoryName.trim();
        if (cleanName === '') return;

        const data = StorageManager.getData();
        
        if (categoryNameMapping[cleanName] || (data.prompts.custom && data.prompts.custom[cleanName])) {
            alert('分类名称已存在');
            return;
        }

        if (!data.prompts.custom) data.prompts.custom = {};
        data.prompts.custom[cleanName] = [];
        StorageManager.save(data);

        currentCategoryKey = `custom_${cleanName}`;
        renderCategories();
        renderPrompts();
    });

    btnDeleteCategory.addEventListener('click', () => {
        if (!currentCategoryKey.startsWith('custom_')) return;
        const customKey = currentCategoryKey.replace('custom_', '');
        
        const confirmDelete = confirm(`确认要删除整个分类【${customKey}】以及其中的所有词条吗？`);
        if (confirmDelete) {
            const data = StorageManager.getData();
            if (data.prompts.custom && data.prompts.custom[customKey]) {
                delete data.prompts.custom[customKey];
                StorageManager.save(data);
            }
            // 归位到默认分类
            currentCategoryKey = 'style';
            renderCategories();
            renderPrompts();
        }
    });

    renderCategories();
    renderPrompts();
});
