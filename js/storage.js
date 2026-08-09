/**
 * 全局数据管理器 - 统一负责本地数据读写及备份
 */
const StorageManager = {
    // 默认空数据结构 (已移除所有 Emoji)
    defaultData: {
        theme: 'light',
        apiConfig: {
            openaiUrl: 'https://api.openai.com/v1',
            openaiKey: '',
            novelaiUrl: 'https://api.novelai.net',
            novelaiKey: '',
            corsProxy: 'https://cors-anywhere.herokuapp.com/'
        },
        prompts: {
            presets: {
                style: [
                    { id: 'p_preset_1', name: '杰作', content: 'masterpiece, best quality' },
                    { id: 'p_preset_2', name: '极高细节', content: 'highly detailed, sharp focus' }
                ],
                expression: [
                    { id: 'p_preset_3', name: '微笑', content: 'smile' },
                    { id: 'p_preset_4', name: '注视镜头', content: 'looking at viewer' }
                ],
                character: [],
                outfit: [],
                artistsCombo: [], 
                artistsSolo: [],  
                scenery: []
            },
            custom: {} 
        },
        memos: [], 
        todos: [],  
        aiPresets: [
            { id: 'chat', name: '轻松漫聊', systemPrompt: '你是一个懂二次元的温和助手，请以轻松随和的口吻回答问题。不要使用任何表情符号。', isSystem: true },
            { id: 'magician', name: '提示词魔法师', systemPrompt: '将用户的中文画面描述优化并翻译为NovelAI的英文提示词，只输出逗号分隔的提示词词条，不需要任何额外解释。不要使用任何表情符号。', isSystem: true },
            { id: 'structurer', name: '想法理顺器', systemPrompt: '用户的输入可能比较凌乱。请提取并整理其中的核心要点，分出关键的行动项(TODO)和设定。不要使用任何表情符号。', isSystem: true },
            { id: 'screenplay', name: '剧本编辑器', systemPrompt: '你是一个资深的编剧专家。帮助用户构思、润色、拆解文学剧本或分镜脚本。不要使用任何表情符号。', isSystem: true }
        ]
    },

    init() {
        if (!localStorage.getItem('studio_workbench_data')) {
            this.save(this.defaultData);
        }
    },

    getData() {
        this.init();
        try {
            return JSON.parse(localStorage.getItem('studio_workbench_data'));
        } catch (e) {
            console.error("读取本地数据失败，正在恢复默认数据...", e);
            return this.defaultData;
        }
    },

    save(data) {
        localStorage.setItem('studio_workbench_data', JSON.stringify(data));
    },

    updateKey(key, value) {
        const data = this.getData();
        data[key] = value;
        this.save(data);
    },

    // 一键格式化重置数据
    resetData() {
        localStorage.removeItem('studio_workbench_data');
        this.init();
    },

    exportData() {
        const dataStr = localStorage.getItem('studio_workbench_data') || JSON.stringify(this.defaultData);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        const exportFileDefaultName = `studio_workbench_backup_${new Date().toISOString().slice(0,10)}.json`;
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', exportFileDefaultName);
        linkElement.click();
    },

    importData(file, callback) {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const parsedData = JSON.parse(event.target.result);
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

StorageManager.init();
