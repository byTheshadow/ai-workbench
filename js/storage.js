/**
 * 全局数据管理器 - 统一负责本地数据读写及备份
 */
const StorageManager = {
    // 默认空数据结构
    defaultData: {
        theme: 'light',
        apiConfig: {
            openaiUrl: 'https://api.openai.com/v1',
            openaiKey: '',
            novelaiUrl: '', // 留空，后续步骤结合代理处理
            novelaiKey: '',
            customProviders: []
        },
        prompts: {
            // 预设提示词分类
            presets: {
                style: [],
                expression: [],
                character: [],
                outfit: [],
                artistsCombo: [], // 画师串（含备注）
                artistsSolo: [],  // 单个画师
                scenery: []
            },
            custom: {} // 用户自己添加的分类
        },
        memos: [], // 备忘录
        todos: [],  // 待办事项
        aiPresets: [
            // AI 助手预设
            { id: 'chat', name: '轻松漫聊', systemPrompt: '你是一个懂二次元的温和助手，请以轻松随和的口吻回答问题。', isSystem: true },
            { id: 'magician', name: '提示词魔法师', systemPrompt: '将用户的中文画面描述优化并翻译为Stable Diffusion/NovelAI的英文提示词，只输出逗号分隔的提示词词条，不需要任何额外解释。', isSystem: true },
            { id: 'structurer', name: '想法理顺器', systemPrompt: '用户的输入可能比较凌乱。请提取并整理其中的核心要点，分出关键的行动项(TODO)和设定。', isSystem: true },
            { id: 'screenplay', name: '剧本编辑器', systemPrompt: '你是一个资深的编剧专家。帮助用户构思、润色、拆解文学剧本或分镜脚本。', isSystem: true }
        ]
    },

    // 初始化数据
    init() {
        if (!localStorage.getItem('studio_workbench_data')) {
            this.save(this.defaultData);
        }
    },

    // 获取完整数据
    getData() {
        this.init();
        try {
            return JSON.parse(localStorage.getItem('studio_workbench_data'));
        } catch (e) {
            console.error("读取本地数据失败，正在恢复默认数据...", e);
            return this.defaultData;
        }
    },

    // 保存完整数据
    save(data) {
        localStorage.setItem('studio_workbench_data', JSON.stringify(data));
    },

    // 更新某个大类
    updateKey(key, value) {
        const data = this.getData();
        data[key] = value;
        this.save(data);
    },

    // 一键导出为 JSON 文件
    exportData() {
        const dataStr = localStorage.getItem('studio_workbench_data') || JSON.stringify(this.defaultData);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const exportFileDefaultName = `studio_workbench_backup_${new Date().toISOString().slice(0,10)}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    },

    // 从上传的 JSON 文件导入数据
    importData(file, callback) {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsedData = JSON.parse(event.target.result);
                // 简单校验数据完整度
                if (parsedData.hasOwnProperty('apiConfig') && parsedData.hasOwnProperty('prompts')) {
                    this.save(parsedData);
                    if (callback) callback(true);
                } else {
                    if (callback) callback(false, "文件格式不兼容");
                }
            } catch (e) {
                if (callback) callback(false, "无效的 JSON 数据");
            }
        };
        reader.readAsText(file);
    }
};

// 立即运行初始化一次
StorageManager.init();
