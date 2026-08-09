/**
 * THE STUDIO WORKBENCH - GENERATOR MODULE
 * 纯前端生图工作室核心逻辑
 */

// ==========================================================================
// 1. INDEXEDDB 本地存储控制 (防爆 localStorage)
// ==========================================================================
const DB_NAME = 'studio_workbench_gallery';
const DB_VERSION = 1;
const STORE_NAME = 'gallery';

class GalleryDB {
    static open() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => resolve(request.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };
        });
    }

    static async save(item) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.put(item);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    static async getAll() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            request.onsuccess = () => {
                // 按生成时间倒序排列
                const list = request.result || [];
                list.sort((a, b) => b.timestamp - a.timestamp);
                resolve(list);
            };
            request.onerror = () => reject(request.error);
        });
    }

    static async delete(id) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.delete(id);
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    static async deleteMultiple(ids) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            let successCount = 0;
            ids.forEach(id => {
                const req = store.delete(id);
                req.onsuccess = () => {
                    successCount++;
                    if (successCount === ids.length) resolve(true);
                };
            });
            if (ids.length === 0) resolve(true);
        });
    }
}

// ==========================================================================
// 2. 并发队列调度器 (Task Queue Scheduler)
// ==========================================================================
class QueueScheduler {
    constructor(maxConcurrency = 5) {
        this.maxConcurrency = maxConcurrency;
        this.queue = [];      // 等待执行的任务
        this.active = [];     // 正在执行的任务
        this.listeners = [];  // 队列状态监听器
    }

    addEventListener(callback) {
        this.listeners.push(callback);
    }

    notify() {
        this.listeners.forEach(cb => cb({ queue: this.queue, active: this.active }));
    }

    // 入队生图任务
    enqueue(task) {
        task.status = 'waiting';
        task.progress = 0;
        task.id = task.id || 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        task.timestamp = Date.now();
        task.controller = new AbortController();
        this.queue.push(task);
        this.notify();
        this.schedule();
    }

    // 取消任务
    cancel(taskId) {
        // 先检查是否在等待队列
        const qIdx = this.queue.findIndex(t => t.id === taskId);
        if (qIdx > -1) {
            this.queue.splice(qIdx, 1);
            this.notify();
            return;
        }
        // 检查是否正在执行，若有则强行 Abort 中断请求
        const aIdx = this.active.findIndex(t => t.id === taskId);
        if (aIdx > -1) {
            const activeTask = this.active[aIdx];
            activeTask.controller.abort();
            this.active.splice(aIdx, 1);
            this.notify();
            this.schedule();
        }
    }

    // 调度策略
    schedule() {
        while (this.active.length < this.maxConcurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            task.status = 'generating';
            this.active.push(task);
            this.notify();
            this.executeTask(task);
        }
    }

    // 真正的接口发起层
    async executeTask(task) {
        try {
            // 模拟或真实抓取 API Config 
            const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
            const apiConfig = globalData.apiConfig || {};

            let finalImageBlob = null;
            let finalSeed = task.params.seed;
            // 设定随机种子
            if (finalSeed === -1) {
                finalSeed = Math.floor(Math.random() * 9999999999);
            }

            // 分流处理不同引擎的 Payload
            if (task.backend === 'novelai') {
                const proxyUrl = apiConfig.corsProxy || '';
                const apiEndpoint = 'https://image.novelai.net/ai/generate-image';
                const fullUrl = proxyUrl + apiEndpoint;

                if (!apiConfig.novelaiKey) {
                    throw new Error('未配置 NovelAI API Key，请先前往“设置”面板配置。');
                }

                // 拼装 NovelAI 特有的 Payload
                const payload = {
                    input: task.prompt,
                    model: task.params.model || 'nai-diffusion-3',
                    action: 'generate',
                    parameters: {
                        width: parseInt(task.params.width),
                        height: parseInt(task.params.height),
                        scale: parseFloat(task.params.scale),
                        sampler: task.params.sampler || 'k_euler',
                        steps: parseInt(task.params.steps),
                        seed: finalSeed,
                        n_samples: 1,
                        ucPreset: 0,
                        uc: task.params.negativePrompt || '',
                        sm: !!task.params.smea,
                        sm_dyn: !!task.params.smeaDyn
                    }
                };

                // 发起请求 (利用 AbortController 控制中断)
                const response = await fetch(fullUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiConfig.novelaiKey}`
                    },
                    body: JSON.stringify(payload),
                    signal: task.controller.signal
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`NovelAI 引擎报错: Status ${response.status} - ${errText}`);
                }

                const arrayBuffer = await response.arrayBuffer();

                // 使用 JSZip 在纯前端解压返回的 application/x-zip-compressed 压缩包
                if (typeof JSZip === 'undefined') {
                    throw new Error('JSZip 依赖库加载失败，请检查网络链接或引入地址。');
                }
                const zip = new JSZip();
                const unzipped = await zip.loadAsync(arrayBuffer);
                
                // 遍历获取图片
                let fileObj = null;
                for (let filename in unzipped.files) {
                    if (filename.endsWith('.png')) {
                        fileObj = unzipped.files[filename];
                        break;
                    }
                }
                
                if (!fileObj) {
                    throw new Error('解包 ZIP 成功，但未能在压缩流中检索到 PNG 图像。');
                }

                finalImageBlob = await fileObj.async('blob');

            } else if (task.backend === 'sd') {
                // Stable Diffusion WebUI 引擎
                const sdBaseUrl = apiConfig.sdUrl || 'http://127.0.0.1:7860';
                // 区分是否为图生图
                const isImg2Img = !!task.params.vibeBase64;
                const endpoint = isImg2Img ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img';
                const fullUrl = sdBaseUrl.replace(/\/$/, '') + endpoint;

                const payload = {
                    prompt: task.prompt,
                    negative_prompt: task.params.negativePrompt || '',
                    steps: parseInt(task.params.steps),
                    cfg_scale: parseFloat(task.params.scale),
                    width: parseInt(task.params.width),
                    height: parseInt(task.params.height),
                    seed: finalSeed,
                    sampler_name: task.params.sampler === 'k_euler' ? 'Euler' : 
                                  task.params.sampler === 'k_euler_ancestral' ? 'Euler a' : 
                                  task.params.sampler === 'k_dpmpp_2m' ? 'DPM++ 2M' : 'DDIM',
                    // 动态覆盖正在运行的模型，达到“选哪个模型就用哪个模型生图”的目的
                    override_settings: {
                        sd_model_checkpoint: task.params.model || ""
                    }
                };

                if (isImg2Img) {
                    payload.init_images = [task.params.vibeBase64];
                    payload.denoising_strength = parseFloat(task.params.vibeStrength || 0.6);
                }

                const response = await fetch(fullUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: task.controller.signal
                });

                if (!response.ok) {
                    throw new Error(`SD WebUI 引擎响应异常: Status ${response.status}`);
                }

                const result = await response.json();
                if (!result.images || result.images.length === 0) {
                    throw new Error('SD API 响应正常，但回传图像列表为空。');
                }

                // SD 返回的是 Base64，需要转成二进制 Blob
                const base64Str = result.images[0];
                const resByte = atob(base64Str);
                const byteNumbers = new Array(resByte.length);
                for (let i = 0; i < resByte.length; i++) {
                    byteNumbers[i] = resByte.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                finalImageBlob = new Blob([byteArray], { type: 'image/png' });

            } else if (task.backend === 'v1') {
                // 通用 OpenAI 兼容 /v1 接口
                const v1Base = apiConfig.sdUrl || '';
                const fullUrl = v1Base.replace(/\/$/, '') + '/v1/images/generations';

                          
                const payload = {
                    prompt: task.prompt,
                    n: 1,
                    size: `${task.params.width}x${task.params.height}`,
                    response_format: 'b64_json',
                    model: task.params.model || 'dall-e-3' // 使用草稿中选择并留底的模型名称
                };

                const response = await fetch(fullUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': apiConfig.openaiKey ? `Bearer ${apiConfig.openaiKey}` : ''
                    },
                    body: JSON.stringify(payload),
                    signal: task.controller.signal
                });

                if (!response.ok) {
                    throw new Error(`通用 API 响应异常: Status ${response.status}`);
                }

                const result = await response.json();
                if (!result.data || result.data.length === 0) {
                    throw new Error('通用 /v1 API 响应正常，但未检测到 data 数组。');
                }

                const b64 = result.data[0].b64_json;
                if (!b64) {
                    throw new Error('未获取到 b64_json 格式图像数据。');
                }

                const byteCharacters = atob(b64);
                const byteNums = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNums[i] = byteCharacters.charCodeAt(i);
                }
                finalImageBlob = new Blob([new Uint8Array(byteNums)], { type: 'image/png' });
            }

            // 保存到 IndexedDB
            const record = {
                id: task.id,
                timestamp: task.timestamp,
                backend: task.backend,
                prompt: task.prompt,
                negativePrompt: task.params.negativePrompt,
                params: {
                    width: task.params.width,
                    height: task.params.height,
                    steps: task.params.steps,
                    scale: task.params.scale,
                    sampler: task.params.sampler,
                    seed: finalSeed,
                    model: task.params.model || '',
                    smea: task.params.smea || false,
                    smeaDyn: task.params.smeaDyn || false,
                    vibeStrength: task.params.vibeStrength || 0.6
                },
                imageBlob: finalImageBlob
            };

            await GalleryDB.save(record);

            // 从 active 移出并唤醒刷新
            this.active = this.active.filter(t => t.id !== task.id);
            this.notify();
            this.schedule();

            // 触发成功后刷新画廊
            if (window.StudioManager) {
                window.StudioManager.refreshGallery();
                // 如果设置了锁定上一次种子的需求，记录最后成功的 seed
                window.StudioManager.lastSuccessfulSeed = finalSeed;
            }

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log(`生图任务 ${task.id} 已被用户强行终止。`);
                return;
            }
            console.error(`生图失败:`, error);
            // 标记失败
            task.status = 'failed';
            task.errorMessage = error.message || '网络连接或后端响应错误';
            this.active = this.active.filter(t => t.id !== task.id);
            this.notify();
            this.schedule();
        }
    }
}

// 实例化全局任务队列
const generatorQueue = new QueueScheduler(5);

// ==========================================================================
// 3. 生图工作室主控管理对象 (StudioManager)
// ==========================================================================
window.StudioManager = {
    // 默认生图草稿模板
    drafts: [
        {
            id: 'draft_default',
            name: '草稿 A',
            prompt: '',
            negativePrompt: '',
            targetBackend: 'novelai',
            artists: [], // 存储画师结构：{ id, name, content, weight }
            params: {
                width: 832,
                height: 1216,
                steps: 28,
                scale: 5.0,
                sampler: 'k_euler',
                seed: -1,
                model: 'nai-diffusion-3',
                smea: false,
                smeaDyn: false,
                vibeBase64: null,
                vibeStrength: 0.6
            }
        }
    ],
    activeDraftId: 'draft_default',
        // 模型内存缓存，避免频繁跨域请求
    modelsCache: {
        novelai: [
            { id: 'nai-diffusion-3', name: 'NovelAI Anime V3' },
            { id: 'nai-diffusion-4-curated-preview', name: 'NovelAI Anime V4 (Curated)' },
            { id: 'safe-diffusion', name: 'Safe Diffusion (写实)' },
            { id: 'nai-diffusion-2', name: 'NovelAI Anime V2' }
        ],
        sd: [],
        v1: []
    },

    // 动态拉取服务器模型
    async fetchModelsFromServer(backend, forceRefresh = false) {
        const self = this;
        
        // 1. 如果是 NovelAI，直接载入本地静态标准模型
        if (backend === 'novelai') {
            self.renderModelOptions(self.modelsCache.novelai);
            return;
        }

        // 2. 如果非强制刷新，且缓存中已有数据，直接读取
        if (!forceRefresh && self.modelsCache[backend] && self.modelsCache[backend].length > 0) {
            self.renderModelOptions(self.modelsCache[backend]);
            return;
        }

        // 3. 开始显示获取状态
        self.modelSelect.innerHTML = '<option value="">正在拉取后端模型...</option>';
        self.btnRefreshModels.classList.add('spin-icon-generating'); // 添加旋转动画效果

        const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
        const apiConfig = globalData.apiConfig || {};

        try {
            if (backend === 'sd') {
                const sdBaseUrl = apiConfig.sdUrl || 'http://127.0.0.1:7860';
                const fullUrl = sdBaseUrl.replace(/\/$/, '') + '/sdapi/v1/sd-models';
                
                const response = await fetch(fullUrl, { method: 'GET' });
                if (!response.ok) throw new Error(`SD 接口无响应: Status ${response.status}`);
                
                const data = await response.json();
                // 转换 SD 返回的格式
                if (Array.isArray(data)) {
                    self.modelsCache.sd = data.map(item => ({
                        id: item.title,          // title 用于 override_settings 传参
                        name: item.model_name    // 简短名称用于显示
                    }));
                }
            } else if (backend === 'v1') {
                const v1Base = apiConfig.sdUrl || '';
                const fullUrl = v1Base.replace(/\/$/, '') + '/v1/models';
                
                const response = await fetch(fullUrl, {
                    method: 'GET',
                    headers: {
                        'Authorization': apiConfig.openaiKey ? `Bearer ${apiConfig.openaiKey}` : ''
                    }
                });
                if (!response.ok) throw new Error(`v1 接口无响应: Status ${response.status}`);
                
                const data = await response.json();
                if (data && Array.isArray(data.data)) {
                    self.modelsCache.v1 = data.data.map(item => ({
                        id: item.id,
                        name: item.id
                    }));
                }
            }

            const currentList = self.modelsCache[backend] || [];
            if (currentList.length === 0) {
                self.modelSelect.innerHTML = '<option value="">未获取到可用模型</option>';
            } else {
                self.renderModelOptions(currentList);
                self.showNotification(`成功获取并缓存了 ${currentList.length} 个后端模型`);
            }
        } catch (error) {
            console.error('获取模型失败:', error);
            self.modelSelect.innerHTML = '<option value="">获取失败，请检查配置或服务状态</option>';
            self.showNotification('模型列表拉取失败，请检查设置中的接口地址');
        } finally {
            self.btnRefreshModels.classList.remove('spin-icon-generating');
        }
    },

    // 将获取到的模型填充到下拉菜单中
    renderModelOptions(models) {
        const self = this;
        self.modelSelect.innerHTML = '';
        models.forEach(model => {
            const opt = document.createElement('option');
            opt.value = model.id;
            opt.textContent = model.name;
            self.modelSelect.appendChild(opt);
        });
        
        // 渲染完下拉菜单后，回填当前草稿正在选中的模型（如果存在）
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (activeDraft && activeDraft.params.model) {
            self.modelSelect.value = activeDraft.params.model;
        }
    },

    // ==========================================================================
    // 4. UI 绑定与核心初始化 (Studio DOM Binding)
    // ==========================================================================
    async init() {
        const self = this;
        
        // 绑定 DOM 节点
        self.btnGenerate = document.getElementById('btn_generate');
        self.btnInterrupt = document.getElementById('btn_interrupt');
        self.btnRandomSeed = document.getElementById('btn_random_seed');
        self.btnLockSeed = document.getElementById('btn_lock_seed');
        self.btnRefreshModels = document.getElementById('btn_refresh_models');
        
        self.taPrompt = document.getElementById('ta_prompt');
        self.taNegativePrompt = document.getElementById('ta_negative_prompt');
        
        self.engineSelect = document.getElementById('select_engine');
        self.modelSelect = document.getElementById('select_model');
        self.samplerSelect = document.getElementById('select_sampler');
        
        self.rangeWidth = document.getElementById('range_width');
        self.valWidth = document.getElementById('val_width');
        self.rangeHeight = document.getElementById('range_height');
        self.valHeight = document.getElementById('val_height');
        
        self.rangeSteps = document.getElementById('range_steps');
        self.valSteps = document.getElementById('val_steps');
        self.rangeScale = document.getElementById('range_scale');
        self.valScale = document.getElementById('val_scale');
        self.inputSeed = document.getElementById('input_seed');
        
        // 特有参数容器与控制
        self.novelaiExtraParams = document.getElementById('novelai_extra_params');
        self.cbSmea = document.getElementById('cb_smea');
        self.cbSmeaDyn = document.getElementById('cb_smea_dyn');
        
        self.sdExtraParams = document.getElementById('sd_extra_params');
        self.vibeImageUpload = document.getElementById('vibe_image_upload');
        self.vibePreviewContainer = document.getElementById('vibe_preview_container');
        self.imgVibePreview = document.getElementById('img_vibe_preview');
        self.btnDeleteVibe = document.getElementById('btn_delete_vibe');
        self.rangeVibeStrength = document.getElementById('range_vibe_strength');
        self.valVibeStrength = document.getElementById('val_vibe_strength');

        // 画廊与历史节点
        self.galleryGrid = document.getElementById('gallery_grid');
        self.btnBatchDelete = document.getElementById('btn_batch_delete');
        self.btnBatchDownload = document.getElementById('btn_batch_download');
        self.btnSelectAll = document.getElementById('btn_select_all');
        self.btnDeselectAll = document.getElementById('btn_deselect_all');
        self.gallerySelectionCount = document.getElementById('gallery_selection_count');

        // 草稿列表栏与管理
        self.draftsList = document.getElementById('drafts_list');
        self.btnAddDraft = document.getElementById('btn_add_draft');

        // 用于追踪锁定上一次成功种子的辅助变量
        self.lastSuccessfulSeed = -1;
        // 批量选择缓存
        self.selectedImageIds = [];

        // 从 LocalStorage 加载草稿历史与当前选中
        const savedDrafts = localStorage.getItem('studio_workbench_drafts');
        if (savedDrafts) {
            try {
                self.drafts = JSON.parse(savedDrafts);
            } catch(e) {
                console.error("加载草稿历史失败，使用默认值", e);
            }
        }
        const savedActiveId = localStorage.getItem('studio_workbench_active_draft_id');
        if (savedActiveId && self.drafts.some(d => d.id === savedActiveId)) {
            self.activeDraftId = savedActiveId;
        }

        // 初始化基本监听器与渲染
        self.initEventListeners();
        self.renderDraftsList();
        self.loadActiveDraftToUI();
        self.refreshGallery();

        // 监听队列状态同步更新 UI 状态
        generatorQueue.addEventListener(({ queue, active }) => {
            self.updateGeneratorStatusUI(queue, active);
        });

        // 绑定自动刷新模型选项
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (activeDraft) {
            await self.fetchModelsFromServer(activeDraft.targetBackend);
        }
    },

    // 绑定所有的界面事件
    initEventListeners() {
        const self = this;

        // 1. 输入内容与参数的双向绑定与自动保存
        const autoSaveInputs = [
            self.taPrompt, self.taNegativePrompt, self.engineSelect, self.modelSelect,
            self.samplerSelect, self.rangeWidth, self.rangeHeight, self.rangeSteps,
            self.rangeScale, self.inputSeed, self.cbSmea, self.cbSmeaDyn,
            self.rangeVibeStrength
        ];
        
        autoSaveInputs.forEach(el => {
            if (!el) return;
            const eventType = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
            el.addEventListener(eventType, () => {
                self.saveUIToActiveDraft();
                self.syncRangeValues();
            });
        });

        // 引擎切换特殊逻辑：同步切换支持的模型选项、控制参数的显隐
        self.engineSelect.addEventListener('change', async (e) => {
            const selectedBackend = e.target.value;
            
            // 切换参数面板显示
            if (selectedBackend === 'novelai') {
                self.novelaiExtraParams.style.display = 'block';
                self.sdExtraParams.style.display = 'none';
            } else if (selectedBackend === 'sd') {
                self.novelaiExtraParams.style.display = 'none';
                self.sdExtraParams.style.display = 'block';
            } else {
                self.novelaiExtraParams.style.display = 'none';
                self.sdExtraParams.style.display = 'none';
            }

            // 拉取并装载模型
            await self.fetchModelsFromServer(selectedBackend);
            
            // 联动保存
            self.saveUIToActiveDraft();
        });

        // 模型手动刷新
        self.btnRefreshModels.addEventListener('click', async () => {
            const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
            if (activeDraft) {
                await self.fetchModelsFromServer(activeDraft.targetBackend, true);
            }
        });

        // 随机种子与锁定种子
        self.btnRandomSeed.addEventListener('click', () => {
            self.inputSeed.value = -1;
            self.saveUIToActiveDraft();
        });
        self.btnLockSeed.addEventListener('click', () => {
            if (self.lastSuccessfulSeed && self.lastSuccessfulSeed !== -1) {
                self.inputSeed.value = self.lastSuccessfulSeed;
                self.saveUIToActiveDraft();
                self.showNotification(`已锁定上次成功的种子: ${self.lastSuccessfulSeed}`);
            } else {
                self.showNotification('尚未有成功生成的图片种子');
            }
        });

        // SD 图生图 Vibe 参考图上传与删除
        self.vibeImageUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                const base64 = event.target.result;
                self.imgVibePreview.src = base64;
                self.vibePreviewContainer.style.display = 'block';
                self.vibeImageUpload.value = ''; // 清空 file input

                // 保存到草稿
                const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
                if (activeDraft) {
                    activeDraft.params.vibeBase64 = base64;
                    self.saveDraftsToStorage();
                }
            };
            reader.readAsDataURL(file);
        });

        self.btnDeleteVibe.addEventListener('click', () => {
            self.vibePreviewContainer.style.display = 'none';
            self.imgVibePreview.src = '';
            
            const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
            if (activeDraft) {
                activeDraft.params.vibeBase64 = null;
                self.saveDraftsToStorage();
            }
        });

        // 2. 新增草稿
        self.btnAddDraft.addEventListener('click', () => {
            const newId = 'draft_' + Date.now();
            const newName = `草稿 ${String.fromCharCode(65 + (self.drafts.length % 26))}`;
            
            // 复制当前草稿的参数作为模板创建新草稿，体验更连贯
            const activeDraft = self.drafts.find(d => d.id === self.activeDraftId) || self.drafts[0];
            const newDraft = {
                id: newId,
                name: newName,
                prompt: activeDraft.prompt || '',
                negativePrompt: activeDraft.negativePrompt || '',
                targetBackend: activeDraft.targetBackend || 'novelai',
                artists: activeDraft.artists ? JSON.parse(JSON.stringify(activeDraft.artists)) : [],
                params: JSON.parse(JSON.stringify(activeDraft.params))
            };

            self.drafts.push(newDraft);
            self.activeDraftId = newId;
            self.saveDraftsToStorage();
            
            self.renderDraftsList();
            self.loadActiveDraftToUI();
            self.fetchModelsFromServer(newDraft.targetBackend);
        });

        // 3. 画廊批量管理操作
        self.btnSelectAll.addEventListener('click', () => {
            const cards = self.galleryGrid.querySelectorAll('.gallery-card');
            self.selectedImageIds = [];
            cards.forEach(card => {
                const id = card.dataset.id;
                card.classList.add('selected');
                self.selectedImageIds.push(id);
            });
            self.updateBatchActionBar();
        });

        self.btnDeselectAll.addEventListener('click', () => {
            const cards = self.galleryGrid.querySelectorAll('.gallery-card');
            cards.forEach(card => card.classList.remove('selected'));
            self.selectedImageIds = [];
            self.updateBatchActionBar();
        });

        self.btnBatchDelete.addEventListener('click', async () => {
            if (self.selectedImageIds.length === 0) return;
            if (confirm(`确定要永久删除这 ${self.selectedImageIds.length} 张生成的图片吗？`)) {
                await GalleryDB.deleteMultiple(self.selectedImageIds);
                self.selectedImageIds = [];
                self.updateBatchActionBar();
                self.refreshGallery();
                self.showNotification('批量删除成功');
            }
        });

        self.btnBatchDownload.addEventListener('click', () => {
            if (self.selectedImageIds.length === 0) return;
            self.downloadMultipleImages(self.selectedImageIds);
        });

        // 4. 生图主动作：生成与强行中断
        self.btnGenerate.addEventListener('click', () => {
            self.triggerGenerateAction();
        });

        self.btnInterrupt.addEventListener('click', () => {
            // 中断当前所有 active 任务
            const activeTasks = [...generatorQueue.active];
            if (activeTasks.length > 0) {
                activeTasks.forEach(task => {
                    generatorQueue.cancel(task.id);
                });
                self.showNotification('已强行发送中断信号');
            }
        });
        
        // 支持 Ctrl + Enter / Command + Enter 快捷键生成
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                // 如果当前没有处于生成态，触发生成
                if (!self.btnGenerate.disabled) {
                    e.preventDefault();
                    self.triggerGenerateAction();
                }
            }
        });
    },

    // 同步 Slider 拖拽和数字文本显示
    syncRangeValues() {
        const self = this;
        if (self.valWidth) self.valWidth.textContent = self.rangeWidth.value;
        if (self.valHeight) self.valHeight.textContent = self.rangeHeight.value;
        if (self.valSteps) self.valSteps.textContent = self.rangeSteps.value;
        if (self.valScale) self.valScale.textContent = parseFloat(self.rangeScale.value).toFixed(1);
        if (self.valVibeStrength) self.valVibeStrength.textContent = parseFloat(self.rangeVibeStrength.value).toFixed(2);
    },

    // 从存储渲染草稿列表栏
    renderDraftsList() {
        const self = this;
        self.draftsList.innerHTML = '';

        self.drafts.forEach(draft => {
            const item = document.createElement('div');
            item.className = `draft-item ${draft.id === self.activeDraftId ? 'active' : ''}`;
            item.dataset.id = draft.id;

            // 文本显示
            const textSpan = document.createElement('span');
            textSpan.className = 'draft-name';
            textSpan.textContent = draft.name;
            textSpan.addEventListener('click', () => {
                self.activeDraftId = draft.id;
                self.saveDraftsToStorage();
                self.renderDraftsList();
                self.loadActiveDraftToUI();
                self.fetchModelsFromServer(draft.targetBackend);
            });

            // 双击可修改草稿名称
            textSpan.addEventListener('dblclick', () => {
                const newName = prompt('修改草稿名称为：', draft.name);
                if (newName && newName.trim() !== '') {
                    draft.name = newName.trim();
                    self.saveDraftsToStorage();
                    self.renderDraftsList();
                }
            });

            // 删除按钮
            const btnDel = document.createElement('button');
            btnDel.className = 'draft-del-btn';
            btnDel.innerHTML = '&times;';
            btnDel.addEventListener('click', (e) => {
                e.stopPropagation();
                if (self.drafts.length <= 1) {
                    alert('请至少保留一个工作草稿');
                    return;
                }
                if (confirm(`确定删除草稿 "${draft.name}" 吗？`)) {
                    self.drafts = self.drafts.filter(d => d.id !== draft.id);
                    if (self.activeDraftId === draft.id) {
                        self.activeDraftId = self.drafts[0].id;
                    }
                    self.saveDraftsToStorage();
                    self.renderDraftsList();
                    self.loadActiveDraftToUI();
                    
                    const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
                    self.fetchModelsFromServer(activeDraft.targetBackend);
                }
            });

            item.appendChild(textSpan);
            item.appendChild(btnDel);
            self.draftsList.appendChild(item);
        });
    },

    // 把当前激活的草稿参数，写回并回填到 UI
    loadActiveDraftToUI() {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        // 回填文本
        self.taPrompt.value = activeDraft.prompt || '';
        self.taNegativePrompt.value = activeDraft.negativePrompt || '';

        // 回填下拉和基本参数
        self.engineSelect.value = activeDraft.targetBackend || 'novelai';
        self.samplerSelect.value = activeDraft.params.sampler || 'k_euler';
        self.inputSeed.value = activeDraft.params.seed !== undefined ? activeDraft.params.seed : -1;

        self.rangeWidth.value = activeDraft.params.width || 832;
        self.rangeHeight.value = activeDraft.params.height || 1216;
        self.rangeSteps.value = activeDraft.params.steps || 28;
        self.rangeScale.value = activeDraft.params.scale || 5.0;

        // 回填特有组件
        if (activeDraft.targetBackend === 'novelai') {
            self.novelaiExtraParams.style.display = 'block';
            self.sdExtraParams.style.display = 'none';
            self.cbSmea.checked = !!activeDraft.params.smea;
            self.cbSmeaDyn.checked = !!activeDraft.params.smeaDyn;
        } else if (activeDraft.targetBackend === 'sd') {
            self.novelaiExtraParams.style.display = 'none';
            self.sdExtraParams.style.display = 'block';
            
            if (activeDraft.params.vibeBase64) {
                self.imgVibePreview.src = activeDraft.params.vibeBase64;
                self.vibePreviewContainer.style.display = 'block';
            } else {
                self.vibePreviewContainer.style.display = 'none';
                self.imgVibePreview.src = '';
            }
            self.rangeVibeStrength.value = activeDraft.params.vibeStrength || 0.6;
        } else {
            self.novelaiExtraParams.style.display = 'none';
            self.sdExtraParams.style.display = 'none';
        }

        // 调用同步数值
        self.syncRangeValues();
    },

    // 抓取当前 UI 的数据保存到激活草稿对象中
    saveUIToActiveDraft() {
        const self = this;
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        activeDraft.prompt = self.taPrompt.value;
        activeDraft.negativePrompt = self.taNegativePrompt.value;
        activeDraft.targetBackend = self.engineSelect.value;
        
        activeDraft.params.sampler = self.samplerSelect.value;
        activeDraft.params.seed = parseInt(self.inputSeed.value) || -1;
        activeDraft.params.width = parseInt(self.rangeWidth.value);
        activeDraft.params.height = parseInt(self.rangeHeight.value);
        activeDraft.params.steps = parseInt(self.rangeSteps.value);
        activeDraft.params.scale = parseFloat(self.rangeScale.value);
        activeDraft.params.model = self.modelSelect.value || '';

        if (activeDraft.targetBackend === 'novelai') {
            activeDraft.params.smea = self.cbSmea.checked;
            activeDraft.params.smeaDyn = self.cbSmeaDyn.checked;
        } else if (activeDraft.targetBackend === 'sd') {
            activeDraft.params.vibeStrength = parseFloat(self.rangeVibeStrength.value);
            // vibeBase64 已经在上传和删除时单独维护，这里不需要重复抓取
        }

        self.saveDraftsToStorage();
    },

    saveDraftsToStorage() {
        const self = this;
        localStorage.setItem('studio_workbench_drafts', JSON.stringify(self.drafts));
        localStorage.setItem('studio_workbench_active_draft_id', self.activeDraftId);
    },

    // 发起生成任务
    triggerGenerateAction() {
        const self = this;
        
        // 1. 抓取与保存当前草稿
        self.saveUIToActiveDraft();
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        // 2. 构造 Task 放入 Scheduler 队列
        const task = {
            backend: activeDraft.targetBackend,
            prompt: activeDraft.prompt,
            params: {
                ...activeDraft.params
            }
        };

        generatorQueue.enqueue(task);
        self.showNotification('生图请求已成功提交至队列');
    },

    // 监听队列状态同步更新 UI 生成按钮
    updateGeneratorStatusUI(queue, active) {
        const self = this;
        const totalCount = queue.length + active.length;

        if (totalCount > 0) {
            // 处于生成排队状态
            self.btnGenerate.disabled = true;
            self.btnGenerate.classList.add('generating');
            
            // 带有动画的生成状态文案
            if (active.length > 0) {
                self.btnGenerate.innerHTML = `
                    <svg class="spin-icon-generating" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10" stroke-opacity="0.25"></circle>
                        <path d="M12 2C6.47715 2 2 6.47715 2 12C2 13.578 2.366 15.07 3.017 16.4" stroke-linecap="round"></path>
                    </svg>
                    <span>正在绘制 (${active.length} 并发 / ${queue.length} 排队)</span>
                `;
                self.btnInterrupt.style.display = 'inline-flex';
            } else {
                self.btnGenerate.innerHTML = `<span>等待资源分配中...</span>`;
            }
        } else {
            // 处于闲置状态
            self.btnGenerate.disabled = false;
            self.btnGenerate.classList.remove('generating');
            self.btnGenerate.innerHTML = `
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span>开始生成 (CTRL+ENTER)</span>
            `;
            self.btnInterrupt.style.display = 'none';
        }
    },

    // ==========================================================================
    // 5. 画廊局部刷新与交互 (Gallery Core UI)
    // ==========================================================================
    async refreshGallery() {
        const self = this;
        
        try {
            const list = await GalleryDB.getAll();
            self.renderGalleryGrid(list);
        } catch(e) {
            console.error('刷新画廊失败:', e);
        }
    },

    renderGalleryGrid(items) {
        const self = this;
        self.galleryGrid.innerHTML = '';

        if (items.length === 0) {
            self.galleryGrid.innerHTML = `
                <div class="gallery-empty">
                    <p>暂无任何生成作品</p>
                    <span>在上方工作台调整参数并点击“开始生成”，作品将自动记录于此。</span>
                </div>
            `;
            return;
        }

        items.forEach(item => {
            const card = document.createElement('div');
            card.className = `gallery-card ${self.selectedImageIds.includes(item.id) ? 'selected' : ''}`;
            card.dataset.id = item.id;

            // 图片容器与对象 URL 控制（防内存泄漏）
            const imgWrapper = document.createElement('div');
            imgWrapper.className = 'gallery-img-wrapper';

            const img = document.createElement('img');
            img.loading = 'lazy';
            
            // 将 Blob 数据转换成前端可见的 Object URL 
            const objectUrl = URL.createObjectURL(item.imageBlob);
            img.src = objectUrl;

            // 附送清理 Object URL，在 DOM 卸载或销毁时进行释放
            img.addEventListener('load', () => {
                // 加载成功后即可销毁对象引用，避免过多内存开销
                URL.revokeObjectURL(objectUrl);
            });

            imgWrapper.appendChild(img);

            // 卡片遮罩，控制参数预览和单张下载/删除按钮
            const overlay = document.createElement('div');
            overlay.className = 'gallery-overlay';

            const overlayContent = document.createElement('div');
            overlayContent.className = 'gallery-overlay-content';

            const infoPrompt = document.createElement('p');
            infoPrompt.className = 'overlay-prompt';
            infoPrompt.textContent = item.prompt;
            infoPrompt.title = item.prompt;

            const infoMeta = document.createElement('div');
            infoMeta.className = 'overlay-meta';
            infoMeta.innerHTML = `
                <span>${item.backend.toUpperCase()}</span>
                <span>${item.params.width}x${item.params.height}</span>
                <span>SEED: ${item.params.seed}</span>
            `;

            overlayContent.appendChild(infoPrompt);
            overlayContent.appendChild(infoMeta);

            // 动作按钮容器
            const actionContainer = document.createElement('div');
            actionContainer.className = 'overlay-actions';

            // 1. 发送回工作台
            const btnSend = document.createElement('button');
            btnSend.title = '回填至工作台';
            btnSend.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
                </svg>
            `;
            btnSend.addEventListener('click', (e) => {
                e.stopPropagation();
                self.sendBackToWorkbench(item);
            });

            // 2. 另存为下载
            const btnDl = document.createElement('button');
            btnDl.title = '保存到本地';
            btnDl.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline>
                    <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
            `;
            btnDl.addEventListener('click', (e) => {
                e.stopPropagation();
                self.downloadSingleImage(item.id);
            });

            // 3. 删除
            const btnDel = document.createElement('button');
            btnDel.title = '永久删除';
            btnDel.className = 'action-danger';
            btnDel.innerHTML = `
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            `;
            btnDel.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm('确认永久删除这张生成图吗？')) {
                    await GalleryDB.delete(item.id);
                    self.refreshGallery();
                    // 同时检查选择列表并移出
                    self.selectedImageIds = self.selectedImageIds.filter(id => id !== item.id);
                    self.updateBatchActionBar();
                    self.showNotification('删除成功');
                }
            });

            actionContainer.appendChild(btnSend);
            actionContainer.appendChild(btnDl);
            actionContainer.appendChild(btnDel);

            overlay.appendChild(overlayContent);
            overlay.appendChild(actionContainer);

            card.appendChild(imgWrapper);
            card.appendChild(overlay);

            // 点击卡片切换选择态，方便批量下载/删除
            card.addEventListener('click', () => {
                if (self.selectedImageIds.includes(item.id)) {
                    self.selectedImageIds = self.selectedImageIds.filter(id => id !== item.id);
                    card.classList.remove('selected');
                } else {
                    self.selectedImageIds.push(item.id);
                    card.classList.add('selected');
                }
                self.updateBatchActionBar();
            });

            self.galleryGrid.appendChild(card);
        });
    },

    // 动态同步底部动作工具栏的状态
    updateBatchActionBar() {
        const self = this;
        const count = self.selectedImageIds.length;
        self.gallerySelectionCount.textContent = count;
        
        const actionArea = document.querySelector('.gallery-batch-actions');
        if (count > 0) {
            actionArea.classList.add('active');
        } else {
            actionArea.classList.remove('active');
        }
    },

    // 把历史画廊数据反写回工作台
    async sendBackToWorkbench(item) {
        const self = this;
        
        // 双向同步回当前的激活草稿
        const activeDraft = self.drafts.find(d => d.id === self.activeDraftId);
        if (!activeDraft) return;

        activeDraft.prompt = item.prompt;
        activeDraft.negativePrompt = item.negativePrompt || '';
        activeDraft.targetBackend = item.backend;
        
        activeDraft.params.width = item.params.width;
        activeDraft.params.height = item.params.height;
        activeDraft.params.steps = item.params.steps;
        activeDraft.params.scale = item.params.scale;
        activeDraft.params.sampler = item.params.sampler;
        activeDraft.params.seed = item.params.seed;
        activeDraft.params.model = item.params.model || '';

        // NovelAI 特有参数
        if (item.backend === 'novelai') {
            activeDraft.params.smea = !!item.params.smea;
            activeDraft.params.smeaDyn = !!item.params.smeaDyn;
        }

        self.saveDraftsToStorage();
        self.loadActiveDraftToUI();
        
        // 动态根据回填的引擎拉取并定位模型
        await self.fetchModelsFromServer(item.backend);

        self.showNotification('画廊参数已成功还原至工作台');
        
        // 自动平滑滚动回顶部，增强操作体感
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    },

    // 批量与单个图片下载具体执行函数
    async downloadSingleImage(id) {
        const all = await GalleryDB.getAll();
        const item = all.find(i => i.id === id);
        if (!item) return;

        const url = URL.createObjectURL(item.imageBlob);
        const a = document.createElement('a');
        a.href = url;
        // 拼装符合工作流直观的图像名称
        a.download = `${item.backend}_${item.params.seed}_${item.id}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    async downloadMultipleImages(ids) {
        const all = await GalleryDB.getAll();
        const targets = all.filter(i => ids.includes(i.id));

        if (targets.length === 0) return;

        // 如果只有一张图片，直接走普通下载
        if (targets.length === 1) {
            this.downloadSingleImage(targets[0].id);
            return;
        }

        // 多张打包下载
        if (typeof JSZip === 'undefined') {
            alert('未引入打包库 JSZip，将依次触发多文件下载。');
            targets.forEach(item => {
                this.downloadSingleImage(item.id);
            });
            return;
        }

        const zip = new JSZip();
        targets.forEach((item, idx) => {
            const filename = `${item.backend}_${item.params.seed}_${item.id}.png`;
            zip.file(filename, item.imageBlob);
        });

        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `studio_batch_export_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        this.showNotification(`已成功打包 ${targets.length} 张图片并下载`);
    },

    // 通用极简通知机制
    showNotification(msg) {
        const toast = document.createElement('div');
        toast.style.position = 'fixed';
        toast.style.bottom = '2rem';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.background = 'var(--text-primary)';
        toast.style.color = 'var(--bg-base)';
        toast.style.padding = '0.6rem 1.5rem';
        toast.style.borderRadius = '4px';
        toast.style.fontSize = '0.75rem';
        toast.style.letterSpacing = '0.05em';
        toast.style.zIndex = '9999';
        toast.style.boxShadow = 'var(--shadow-lg)';
        toast.textContent = msg.toUpperCase();

        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.4s ease';
            setTimeout(() => toast.remove(), 400);
        }, 2200);
    }
};

// 页面加载完成后自动初始化
document.addEventListener('DOMContentLoaded', () => {
    window.StudioManager.init();
});