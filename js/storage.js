/**
 * 全局数据管理器 - 统一负责本地数据读写及备份
 */
const StorageManager = {
    defaultData: {
        theme: 'light',
        apiConfig: {
            openaiUrl: 'https://api.openai.com/v1',
            openaiKey: '',
            imageV1Url: '', // 👈 新增：独立通用生图 Base URL
            imageV1Key: '', // 👈 新增：独立通用生图 API Key
            novelaiUrl: 'https://api.novelai.net',
            novelaiKey: '',
            sdUrl: 'http://127.0.0.1:7860',
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
        chatSessions: [
            {
                id: 'session_default',
                title: '默认会话',
                presetId: 'chat',
                model: '',
                messages: [
                    { id: 'msg_init', role: 'assistant', content: '你好。我是你的创作助手。你可以点击上方新建不同的会话，并切换不同的专业预设身份来辅助你。', versions: ['你好。我是你的创作助手。你可以点击上方新建不同的会话，并切换不同的专业预设身份来辅助你。'], activeVersionIndex: 0 }
                ]
            }
        ],
        aiPresets: [
            { 
                id: 'chat', 
                name: '轻松漫聊', 
                systemPrompt: '你是一个懂二次元的温和助手，请以轻松随和但严谨的口吻回答问题。回答中应使用杂志感的排版、清晰的分段，且绝对不要使用任何表情符号（Emoji）。', 
                isSystem: true 
            },
            { 
                id: 'magician', 
                name: '提示词魔法师 [NovelAI]', 
                systemPrompt: '接下来你要帮助我生成一组适用于NovelAI的或其他基于Danbooru tag扩散模型的高质量图像生成prompt。构建一个结构清晰细节丰富的prompt。要求如下描述一名角色包括外观特征，服饰，姿势，背景，表情，视角等。从提供的画师串当中随机选择1-3位画师，对每位画师加上0.8到1.2之间的权重，格式为0.9::artist:画师名::并保证画师串之间有协调性风格不冲突。【约束条件】：仅使用Danbooru风格的标签。全部小写，英文，英文逗号分割。应包含常见的高质量标签，比如masterpiece,best quality,ultra-detailed,year2025等。不重复使用同一画师，避免使用可能和画师风格冲突的标签。提示词示范：artsit:moccha_(mochancc),0.9::artist:uminonew::,0.4::artist:ask_(askzy)::,0.9::Artist: liduke::,masterpiece,best quality,year2024,year2025,newest。请直接输出构建好的Danbooru tag串，不要包含任何多余解释与表情符号（Emoji）。', 
                isSystem: true 
            },
            { 
                id: 'structurer', 
                name: '想法理顺器', 
                systemPrompt: '你是一个专业的逻辑思维分析师。用户的输入可能比较散乱、无序。你的任务是站在资深项目管理与创意策划的角度，提取并整理其中的核心创意、隐藏冲突与逻辑链条，并自动分出关键的行动项(TODO)和核心设定。格式上使用冷峻的杂志风格排版，使用清晰的Markdown列表，禁止使用任何表情符号（Emoji）。', 
                isSystem: true 
            },
            { 
                id: 'screenplay', 
                name: '剧本编辑器', 
                systemPrompt: '你是一个资深的编剧专家。你的任务是协助创作者进行文学大纲拆解、故事起承转合论证、冲突设计、分镜脚本润色以及台词打磨。你的回答应极具专业性、直指痛点，并严格遵循专业的剧本文体结构。绝对不要使用任何表情符号（Emoji）。', 
                isSystem: true 
            }
        ]
    },

    init() {
        if (!localStorage.getItem('studio_workbench_data')) {
            this.save(this.defaultData);
        } else {
            const data = JSON.parse(localStorage.getItem('studio_workbench_data'));
            let updated = false;
            
            if (!data.apiConfig) {
                data.apiConfig = this.defaultData.apiConfig;
                updated = true;
            } else {
                if (data.apiConfig.sdUrl === undefined) {
                    data.apiConfig.sdUrl = 'http://127.0.0.1:7860';
                    updated = true;
                }
                if (data.apiConfig.sdKey === undefined) {
                    data.apiConfig.sdKey = '';
                    updated = true;
                }
                if (data.apiConfig.imageV1Url === undefined) {
                    data.apiConfig.imageV1Url = '';
                    updated = true;
                }
                if (data.apiConfig.imageV1Key === undefined) {
                    data.apiConfig.imageV1Key = '';
                    updated = true;
                }
                if (data.apiConfig.novelaiUrl === undefined) {
                    data.apiConfig.novelaiUrl = 'https://api.novelai.net';
                    updated = true;
                }
            }

            if (!data.chatSessions) {
                data.chatSessions = this.defaultData.chatSessions;
                updated = true;
            }
            if (!data.aiPresets) {
                data.aiPresets = this.defaultData.aiPresets;
                updated = true;
            } else {
                const hasMagician = data.aiPresets.some(p => p.id === 'magician');
                if (!hasMagician) {
                    data.aiPresets.push(this.defaultData.aiPresets.find(p => p.id === 'magician'));
                    updated = true;
                }
            }
            if (updated) {
                this.save(data);
            }
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

    resetData() {
        localStorage.removeItem('studio_workbench_data');
        localStorage.removeItem('studio_workbench_drafts');
        localStorage.removeItem('studio_workbench_active_draft_id');
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
                    if (callback) callback(false, "文件数据结构不兼容");
                }
            } catch (e) {
                if (callback) callback(false, "无效的 JSON 数据");
            }
        };
        reader.readAsText(file);
    }
};

StorageManager.init();
