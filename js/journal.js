document.addEventListener('DOMContentLoaded', () => {
    let isEditingMemo = false;
    let isEditingTodo = false;

    // DOM 声明 - 主视图
    const memosList = document.getElementById('memos-list');
    const todoListPending = document.getElementById('todo-list-pending');
    const todoListActive = document.getElementById('todo-list-active');
    const todoListCompleted = document.getElementById('todo-list-completed');
    const progressSummaryText = document.getElementById('progress-summary-text');

    // DOM 声明 - 按钮
    const btnAddMemo = document.getElementById('btn-add-memo');
    const btnAddTodo = document.getElementById('btn-add-todo');

    // DOM 声明 - Memo 模态框
    const memoModal = document.getElementById('memo-modal');
    const btnCloseMemoModal = document.getElementById('btn-close-memo-modal');
    const btnSaveMemo = document.getElementById('btn-save-memo');
    const btnDeleteMemo = document.getElementById('btn-delete-memo');
    const editMemoId = document.getElementById('edit-memo-id');
    const inputMemoTitle = document.getElementById('input-memo-title');
    const inputMemoContent = document.getElementById('input-memo-content');

    // DOM 声明 - Todo 模态框
    const todoModal = document.getElementById('todo-modal');
    const btnCloseTodoModal = document.getElementById('btn-close-todo-modal');
    const btnSaveTodo = document.getElementById('btn-save-todo');
    const btnDeleteTodo = document.getElementById('btn-delete-todo');
    const editTodoId = document.getElementById('edit-todo-id');
    const inputTodoText = document.getElementById('input-todo-text');
    const selectTodoStatus = document.getElementById('select-todo-status');

    // 1. 初始化渲染与进度提醒跟进
    function initJournal() {
        renderMemos();
        renderTodos();
        updateProgressReport();
    }

    // 2. 进度跟进分析报告
    function updateProgressReport() {
        const data = StorageManager.getData();
        const todos = data.todos || [];

        if (todos.length === 0) {
            progressSummaryText.textContent = "当前尚无任务记录。点击右侧“新增待办”来开始规划你的第一项任务。";
            return;
        }

        const pendingCount = todos.filter(t => t.status === 'pending').length;
        const activeCount = todos.filter(t => t.status === 'active').length;
        const completedCount = todos.filter(t => t.status === 'completed').length;
        const total = todos.length;
        
        const percent = Math.round((completedCount / total) * 100);

        if (percent === 100) {
            progressSummaryText.textContent = "极佳！你已完成了所有待办事项。可以放心开启下一阶段的生图和灵感创作了。";
        } else {
            progressSummaryText.textContent = `当前任务完成度为 ${percent}%。其中有 ${activeCount} 项任务正在进行中，${pendingCount} 项处于待办状态。请保持节奏，跟进未完成的工作。`;
        }
    }

    // 3. 渲染想法备忘录 (Memos)
    function renderMemos() {
        const data = StorageManager.getData();
        const memos = data.memos || [];
        memosList.innerHTML = '';

        if (memos.length === 0) {
            memosList.innerHTML = '<p class="placeholder-text">暂无任何灵感备忘。</p>';
            return;
        }

        // 按时间降序排列（最新发布的在最前）
        const sortedMemos = [...memos].sort((a, b) => b.updatedAt - a.updatedAt);

        sortedMemos.forEach(memo => {
            const card = document.createElement('div');
            card.classList.add('memo-card');
            card.addEventListener('click', () => openMemoModal(memo));

            const dateStr = new Date(memo.updatedAt).toLocaleDateString('zh-CN', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            card.innerHTML = `
                <div class="memo-card-header">
                    <span class="memo-title">${escapeHtml(memo.title || '未命名想法')}</span>
                    <span class="memo-date">${dateStr}</span>
                </div>
                <div class="memo-body">${escapeHtml(memo.content)}</div>
            `;
            memosList.appendChild(card);
        });
    }

    // 4. 渲染任务列表 (Todos)
    function renderTodos() {
        const data = StorageManager.getData();
        const todos = data.todos || [];

        todoListPending.innerHTML = '';
        todoListActive.innerHTML = '';
        todoListCompleted.innerHTML = '';

        const pending = todos.filter(t => t.status === 'pending');
        const active = todos.filter(t => t.status === 'active');
        const completed = todos.filter(t => t.status === 'completed');

        if (pending.length === 0) todoListPending.innerHTML = '<p class="placeholder-text">暂无待办任务。</p>';
        if (active.length === 0) todoListActive.innerHTML = '<p class="placeholder-text">当前无执行中的任务。</p>';
        if (completed.length === 0) todoListCompleted.innerHTML = '<p class="placeholder-text">尚无已完成任务。</p>';

        todos.forEach(todo => {
            const card = document.createElement('div');
            card.classList.add('todo-card');
            if (todo.status === 'completed') {
                card.classList.add('completed-style');
            }

            // 依据不同状态渲染不同的列表
            let parentContainer;
            if (todo.status === 'pending') parentContainer = todoListPending;
            else if (todo.status === 'active') parentContainer = todoListActive;
            else parentContainer = todoListCompleted;

            // 动态构建选中按钮的 SVG
            const checkIcon = todo.status === 'completed' 
                ? `<svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"/></svg>`
                : '';

            card.innerHTML = `
                <div class="todo-card-left">
                    <button class="todo-check-btn ${todo.status === 'completed' ? 'completed' : ''}" data-id="${todo.id}">
                        ${checkIcon}
                    </button>
                    <span class="todo-text">${escapeHtml(todo.text)}</span>
                </div>
                <button class="btn-card-edit edit-todo-trigger" data-id="${todo.id}">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </button>
            `;

            // 绑定事件：勾选切换状态
            card.querySelector('.todo-check-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                toggleTodoStatus(todo.id);
            });

            // 绑定事件：点击标题编辑详情
            card.querySelector('.todo-text').addEventListener('click', () => openTodoModal(todo));
            card.querySelector('.edit-todo-trigger').addEventListener('click', () => openTodoModal(todo));

            parentContainer.appendChild(card);
        });
    }

    // 快捷切换任务状态 (未完成 <-> 已完成)
    function toggleTodoStatus(id) {
        const data = StorageManager.getData();
        const index = data.todos.findIndex(t => t.id === id);
        if (index !== -1) {
            const currentStatus = data.todos[index].status;
            data.todos[index].status = currentStatus === 'completed' ? 'active' : 'completed';
            StorageManager.save(data);
            initJournal();
        }
    }

    // 5. 模态框控制 - Memos
    function openMemoModal(memo = null) {
        if (memo) {
            isEditingMemo = true;
            editMemoId.value = memo.id;
            inputMemoTitle.value = memo.title || '';
            inputMemoContent.value = memo.content;
            btnDeleteMemo.style.display = 'block';
        } else {
            isEditingMemo = false;
            editMemoId.value = '';
            inputMemoTitle.value = '';
            inputMemoContent.value = '';
            btnDeleteMemo.style.display = 'none';
        }
        memoModal.classList.add('open');
    }

    function closeMemoModal() {
        memoModal.classList.remove('open');
    }

    btnAddMemo.addEventListener('click', () => openMemoModal(null));
    btnCloseMemoModal.addEventListener('click', closeMemoModal);

    btnSaveMemo.addEventListener('click', () => {
        const title = inputMemoTitle.value.trim();
        const content = inputMemoContent.value.trim();

        if (!content) {
            alert('详细内容不能为空');
            return;
        }

        const data = StorageManager.getData();
        if (!data.memos) data.memos = [];

        if (isEditingMemo) {
            const index = data.memos.findIndex(m => m.id === editMemoId.value);
            if (index !== -1) {
                data.memos[index] = {
                    ...data.memos[index],
                    title,
                    content,
                    updatedAt: Date.now()
                };
            }
        } else {
            data.memos.push({
                id: 'm_' + Date.now(),
                title,
                content,
                updatedAt: Date.now()
            });
        }

        StorageManager.save(data);
        closeMemoModal();
        initJournal();
    });

    btnDeleteMemo.addEventListener('click', () => {
        if (!confirm('确认要删除这条想法记录吗？')) return;
        const data = StorageManager.getData();
        data.memos = data.memos.filter(m => m.id !== editMemoId.value);
        StorageManager.save(data);
        closeMemoModal();
        initJournal();
    });

    // 6. 模态框控制 - Todos
    function openTodoModal(todo = null) {
        if (todo) {
            isEditingTodo = true;
            editTodoId.value = todo.id;
            inputTodoText.value = todo.text;
            selectTodoStatus.value = todo.status;
            btnDeleteTodo.style.display = 'block';
        } else {
            isEditingTodo = false;
            editTodoId.value = '';
            inputTodoText.value = '';
            selectTodoStatus.value = 'pending';
            btnDeleteTodo.style.display = 'none';
        }
        todoModal.classList.add('open');
    }

    function closeTodoModal() {
        todoModal.classList.remove('open');
    }

    btnAddTodo.addEventListener('click', () => openTodoModal(null));
    btnCloseTodoModal.addEventListener('click', closeTodoModal);

    btnSaveTodo.addEventListener('click', () => {
        const text = inputTodoText.value.trim();
        const status = selectTodoStatus.value;

        if (!text) {
            alert('任务描述不能为空');
            return;
        }

        const data = StorageManager.getData();
        if (!data.todos) data.todos = [];

        if (isEditingTodo) {
            const index = data.todos.findIndex(t => t.id === editTodoId.value);
            if (index !== -1) {
                data.todos[index] = {
                    ...data.todos[index],
                    text,
                    status
                };
            }
        } else {
            data.todos.push({
                id: 't_' + Date.now(),
                text,
                status
            });
        }

        StorageManager.save(data);
        closeTodoModal();
        initJournal();
    });

    btnDeleteTodo.addEventListener('click', () => {
        if (!confirm('确认要删除此待办事项吗？')) return;
        const data = StorageManager.getData();
        data.todos = data.todos.filter(t => t.id !== editTodoId.value);
        StorageManager.save(data);
        closeTodoModal();
        initJournal();
    });

    // 字符过滤
    function escapeHtml(text) {
        if (!text) return '';
        return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    // 每次切换到 Journal 页面时，更新一下进度报告（跟进最新情况）
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', () => {
            if (item.getAttribute('data-target') === 'journal') {
                updateProgressReport();
            }
        });
    });

    // 初次运行
    initJournal();
});
