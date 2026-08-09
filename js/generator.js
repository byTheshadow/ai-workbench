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
                                  task.params.sampler === 'k_dpmpp_2m' ? 'DPM++ 2M' : 'DDIM'
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
                    response_format: 'b64_json'
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
    lastSuccessfulSeed: -1,
    batchMode: false,
    selectedImageIds: new Set(),

    // 初始化方法
    init() {
        this.loadDraftsFromStorage();
        this.setupDOMReferences();
        this.bindEvents();
        this.renderDraftTabs();
        this.syncUIWithActiveDraft();
        this.refreshGallery();

        // 监听提示词书的全局变化，实时单向引入
        this.observeGlobalPromptBuffer();

        // 订阅队列更新
        generatorQueue.addEventListener((state) => {
            this.renderQueueUI(state);
        });
    },

    loadDraftsFromStorage() {
        const stored = localStorage.getItem('studio_generator_drafts');
        if (stored) {
            try {
                this.drafts = JSON.parse(stored);
                if (this.drafts.length > 0) {
                    this.activeDraftId = this.drafts[0].id;
                }
            } catch (e) {
                console.error('还原生图草稿箱数据出错:', e);
            }
        }
    },

    saveDraftsToStorage() {
        localStorage.setItem('studio_generator_drafts', JSON.stringify(this.drafts));
    },

    setupDOMReferences() {
        // 后端 & 输入
        this.backendSelect = document.getElementById('studio-backend-select');
        this.draftTabsList = document.getElementById('studio-draft-tabs-list');
        this.btnAddDraft = document.getElementById('btn-add-draft');
        this.promptInput = document.getElementById('studio-prompt-input');
        this.negativeInput = document.getElementById('studio-negative-input');
        this.ucPresetSelect = document.getElementById('studio-uc-preset');

        // 画师实验室
        this.artistChipsWrap = document.getElementById('artist-chips-wrap');
        this.tensionSlider = document.getElementById('artist-tension-slider');
        this.tensionDisplay = document.getElementById('tension-value-display');
        this.btnAutoWeight = document.getElementById('btn-auto-weight');
        this.btnSaveRecipe = document.getElementById('btn-save-recipe');

        // 渲染参数
        this.ratioButtons = document.querySelectorAll('.ratio-preset-group button');
        this.customDimensionWrap = document.querySelector('.custom-dimension-inputs');
        this.customW = document.getElementById('param-custom-w');
        this.customH = document.getElementById('param-custom-h');

        this.stepsSlider = document.getElementById('param-steps');
        this.stepsNum = document.getElementById('param-steps-num');
        this.scaleSlider = document.getElementById('param-scale');
        this.scaleNum = document.getElementById('param-scale-num');
        this.samplerSelect = document.getElementById('param-sampler');
        this.seedInput = document.getElementById('param-seed');

        this.btnRandomSeed = document.getElementById('btn-random-seed');
        this.btnLockSeed = document.getElementById('btn-lock-seed');

        // NovelAI SMEA
        this.naiParamsWrap = document.getElementById('nai-specific-params');
        this.smeaCheck = document.getElementById('param-smea');
        this.smeaDynWrap = document.getElementById('smea-dyn-wrap');
        this.smeaDynCheck = document.getElementById('param-smea-dyn');

        // 参考图上传
        this.vibeDropzone = document.getElementById('vibe-dropzone');
        this.vibeFileInput = document.getElementById('vibe-file-input');
        this.vibePlaceholder = document.getElementById('vibe-placeholder');
        this.vibePreview = document.getElementById('vibe-preview');
        this.vibePreviewImg = document.getElementById('vibe-preview-img');
        this.btnClearVibe = document.getElementById('btn-clear-vibe');
        this.vibeIntensityWrap = document.getElementById('vibe-intensity-wrap');
        this.vibeStrengthSlider = document.getElementById('vibe-strength');
        this.vibeStrengthNum = document.getElementById('vibe-strength-num');

        // 画廊与操作
        this.galleryGrid = document.getElementById('studio-gallery-grid');
        this.galleryCountLabel = document.getElementById('gallery-count-label');
        this.engineFilterTabs = document.querySelectorAll('.engine-filter-tabs button');
        this.btnToggleBatch = document.getElementById('btn-toggle-batch-mode');
        this.batchActionsBar = document.getElementById('gallery-batch-actions-bar');
        this.batchSelectedCount = document.getElementById('batch-selected-count');
        this.btnBatchSelectAll = document.getElementById('btn-batch-select-all');
        this.btnBatchDownload = document.getElementById('btn-batch-download');
        this.btnBatchDelete = document.getElementById('btn-batch-delete');
        this.btnBatchCancel = document.getElementById('btn-batch-cancel');

        // 按钮触发
        this.btnGenerate = document.getElementById('btn-studio-generate');
        this.btnGenerateText = document.getElementById('btn-generate-text');
        this.btnRollX4 = document.getElementById('btn-studio-roll-x4');
        this.generateSpinIcon = this.btnGenerate.querySelector('.spin-icon-generating');

        // 队列悬浮窗
        this.queueCapsule = document.getElementById('queue-monitor-capsule');
        this.queueDrawer = document.getElementById('queue-monitor-drawer');
        this.queueStatusText = document.getElementById('queue-status-text');
        this.btnCloseQueueDrawer = document.getElementById('btn-close-queue-drawer');
        this.queueDrawerList = document.getElementById('queue-drawer-list');

        // Lightbox 弹窗
        this.lightbox = document.getElementById('lightbox-modal');
        this.lightboxImg = document.getElementById('lightbox-main-img');
        this.lightboxClose = document.getElementById('btn-lightbox-close');
        this.lightboxTimestamp = document.getElementById('lightbox-meta-timestamp');
        this.lightboxEngine = document.getElementById('lightbox-meta-engine');
        this.lightboxPrompt = document.getElementById('lightbox-meta-prompt');
        this.lightboxNegative = document.getElementById('lightbox-meta-negative');
        this.lightboxNegativeSection = document.getElementById('lightbox-meta-uc-section');
        this.lightboxSeed = document.getElementById('lightbox-meta-seed');
        this.lightboxDimension = document.getElementById('lightbox-meta-dimension');
        this.lightboxSteps = document.getElementById('lightbox-meta-steps');
        this.lightboxScale = document.getElementById('lightbox-meta-scale');
        this.lightboxSampler = document.getElementById('lightbox-meta-sampler');
        
        this.btnCopyMetaPrompt = document.getElementById('btn-copy-meta-prompt');
        this.btnLightboxReuse = document.getElementById('btn-lightbox-reuse');
        this.btnLightboxRoll = document.getElementById('btn-lightbox-roll-variations');
        this.btnLightboxDownload = document.getElementById('btn-lightbox-download');
        this.btnLightboxDelete = document.getElementById('btn-lightbox-delete');

        // 配方弹窗
        this.recipeModal = document.getElementById('artist-recipe-modal');
        this.btnCloseRecipeModal = document.getElementById('btn-close-recipe-modal');
        this.inputRecipeName = document.getElementById('input-recipe-name');
        this.inputRecipeRemark = document.getElementById('input-recipe-remark');
        this.recipeContentPreview = document.getElementById('recipe-content-preview');
        this.btnConfirmSaveRecipe = document.getElementById('btn-confirm-save-recipe');

        // 引入词库 Popover 弹出层
        this.lexiconPopover = document.getElementById('lexicon-mini-popover');
        this.btnOpenPopover = document.getElementById('btn-open-lexicon-popover');
        this.btnClosePopover = document.getElementById('btn-close-popover');
        this.popoverCats = document.getElementById('popover-cats');
        this.popoverItemsGrid = document.getElementById('popover-items-grid');
    },

    // 绑定所有的事件处理器
    bindEvents() {
        const self = this;

        // 切换后端引擎
        this.backendSelect.addEventListener('change', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.targetBackend = e.target.value;
            self.saveDraftsToStorage();
            self.syncUIWithActiveDraft();
        });

        // 多草稿操作
        this.btnAddDraft.addEventListener('click', () => {
            const newId = 'draft_' + Date.now();
            const countChar = String.fromCharCode(65 + self.drafts.length); // A, B, C...
            const newDraft = JSON.parse(JSON.stringify(self.drafts[0])); // 深拷贝模板
            newDraft.id = newId;
            newDraft.name = `草稿 ${countChar}`;
            newDraft.prompt = '';
            newDraft.artists = [];
            self.drafts.push(newDraft);
            self.activeDraftId = newId;
            self.saveDraftsToStorage();
            self.renderDraftTabs();
            self.syncUIWithActiveDraft();
        });

        // 提示词输入改变
        this.promptInput.addEventListener('input', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.prompt = e.target.value;
            self.saveDraftsToStorage();
        });

        // 同步到全局缓冲区
        document.getElementById('btn-sync-buffer').addEventListener('click', () => {
            const fullPrompt = self.compileFullPrompt();
            const globalBuffer = document.getElementById('global-prompt-buffer');
            if (globalBuffer) {
                globalBuffer.value = fullPrompt;
                // 触发原生 input 事件以便其他模块同步
                globalBuffer.dispatchEvent(new Event('input', { bubbles: true }));
                self.showNotification('已无缝同步至全局提示词缓冲区');
            }
        });

        // 清空提示词
        document.getElementById('btn-clear-studio-prompt').addEventListener('click', () => {
            self.promptInput.value = '';
            const activeDraft = self.getActiveDraft();
            activeDraft.prompt = '';
            self.saveDraftsToStorage();
        });

        // 负面提示词包预设联动
        this.ucPresetSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            let negativeText = '';
            if (val === 'novelai_v3') {
                negativeText = 'lowres, {bad anatomy}, {bad hands}, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, normal quality, bad feet, cropped, poorly drawn hands, poorly drawn face, mutation, deformed, extra limbs, extra arms, extra legs, malformed limbs, missing arms, missing legs, signature, watermark, username, long neck, bad anatomy, bad proportions, double body, cloned face, deformed limbs, disfigured, fused fingers, too many fingers, duplicate, abnormal hands, multiple heads';
            } else if (val === 'sdxl_anime') {
                negativeText = 'lowres, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry, text, logo';
            } else if (val === 'realism_avoid') {
                negativeText = '3d, photo, photorealistic, realism, ugly, deformed, bad anatomy, noisy, distorted';
            }

            self.negativeInput.value = negativeText;
            const activeDraft = self.getActiveDraft();
            activeDraft.negativePrompt = negativeText;
            self.saveDraftsToStorage();
        });

        this.negativeInput.addEventListener('input', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.negativePrompt = e.target.value;
            self.ucPresetSelect.value = 'custom';
            self.saveDraftsToStorage();
        });

        // 风格张力滑动器控制
        this.tensionSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            self.applyTensionLogic(value);
        });

        // AI一键权重配平
        this.btnAutoWeight.addEventListener('click', () => {
            self.autoWeightArtists();
        });

        // 保存画师配方弹窗唤醒
        this.btnSaveRecipe.addEventListener('click', () => {
            const activeDraft = self.getActiveDraft();
            if (activeDraft.artists.length === 0) {
                alert('当前未引入任何画师，无法生成配方。');
                return;
            }
            const compiled = self.compileArtistsString();
            self.recipeContentPreview.textContent = compiled;
            self.inputRecipeName.value = '';
            self.inputRecipeRemark.value = '';
            self.recipeModal.classList.add('active');
        });

        this.btnCloseRecipeModal.addEventListener('click', () => {
            self.recipeModal.classList.remove('active');
        });

        // 确认保存风格配方到 Lexicon
        this.btnConfirmSaveRecipe.addEventListener('click', () => {
            const name = self.inputRecipeName.value.trim();
            const remark = self.inputRecipeRemark.value.trim();
            if (!name) {
                alert('请填写配方显示名称');
                return;
            }
            const compiled = self.compileArtistsString();

            // 写入本地 Lexicon custom 分类中
            const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
            globalData.prompts = globalData.prompts || {};
            globalData.prompts.custom = globalData.prompts.custom || {};
            
            const catName = '自定义画师风格';
            globalData.prompts.custom[catName] = globalData.prompts.custom[catName] || [];
            
            globalData.prompts.custom[catName].push({
                id: 'recipe_' + Date.now(),
                name: name,
                content: compiled,
                remark: remark || '画师实验配方'
            });

            localStorage.setItem('studio_workbench_data', JSON.stringify(globalData));
            self.recipeModal.classList.remove('active');
            self.showNotification(`配方「${name}」已存入提示词书`);

            // 通知全局 PromptBook 更新
            if (window.PromptBook) {
                window.PromptBook.init();
            }
        });

        // 引入词库浮层
        this.btnOpenPopover.addEventListener('click', () => {
            self.renderPopoverCategories();
            self.lexiconPopover.style.display = 'block';
        });

        this.btnClosePopover.addEventListener('click', () => {
            self.lexiconPopover.style.display = 'none';
        });

        // 监听注入位置单选按钮
        document.querySelectorAll('input[name="artist-inject-pos"]').forEach(radio => {
            radio.addEventListener('change', () => {
                // 仅重绘或触发保存
                self.saveDraftsToStorage();
            });
        });

        // 比例选择按钮联动
        this.ratioButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                self.ratioButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                const activeDraft = self.getActiveDraft();
                if (btn.dataset.ratio) {
                    const [w, h] = btn.dataset.ratio.split('x');
                    activeDraft.params.width = parseInt(w);
                    activeDraft.params.height = parseInt(h);
                    self.customDimensionWrap.style.display = 'none';
                } else if (btn.dataset.custom) {
                    self.customDimensionWrap.style.display = 'grid';
                    activeDraft.params.width = parseInt(self.customW.value);
                    activeDraft.params.height = parseInt(self.customH.value);
                }
                self.saveDraftsToStorage();
            });
        });

        this.customW.addEventListener('input', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.params.width = parseInt(e.target.value) || 512;
            self.saveDraftsToStorage();
        });

        this.customH.addEventListener('input', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.params.height = parseInt(e.target.value) || 512;
            self.saveDraftsToStorage();
        });

        // Slider 与 Number 输入双向绑定
        const setupSliderNumberPair = (slider, numInput, paramKey) => {
            slider.addEventListener('input', (e) => {
                numInput.value = e.target.value;
                const activeDraft = self.getActiveDraft();
                activeDraft.params[paramKey] = parseFloat(e.target.value);
                self.saveDraftsToStorage();
            });
            numInput.addEventListener('input', (e) => {
                slider.value = e.target.value;
                const activeDraft = self.getActiveDraft();
                activeDraft.params[paramKey] = parseFloat(e.target.value);
                self.saveDraftsToStorage();
            });
        };

        setupSliderNumberPair(this.stepsSlider, this.stepsNum, 'steps');
        setupSliderNumberPair(this.scaleSlider, this.scaleNum, 'scale');

        this.samplerSelect.addEventListener('change', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.params.sampler = e.target.value;
            self.saveDraftsToStorage();
        });

        this.seedInput.addEventListener('input', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.params.seed = parseInt(e.target.value) || -1;
            self.saveDraftsToStorage();
        });

        this.btnRandomSeed.addEventListener('click', () => {
            self.seedInput.value = -1;
            const activeDraft = self.getActiveDraft();
            activeDraft.params.seed = -1;
            self.saveDraftsToStorage();
        });

        this.btnLockSeed.addEventListener('click', () => {
            if (self.lastSuccessfulSeed !== -1) {
                self.seedInput.value = self.lastSuccessfulSeed;
                const activeDraft = self.getActiveDraft();
                activeDraft.params.seed = self.lastSuccessfulSeed;
                self.saveDraftsToStorage();
                self.showNotification(`已锁定上次成功 Seed: ${self.lastSuccessfulSeed}`);
            } else {
                alert('暂无上一次成功的种子，请先生成一张图像。');
            }
        });

        // NovelAI SMEA 专属
        this.smeaCheck.addEventListener('change', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.params.smea = e.target.checked;
            self.smeaDynWrap.style.display = e.target.checked ? 'block' : 'none';
            if (!e.target.checked) {
                this.smeaDynCheck.checked = false;
                activeDraft.params.smeaDyn = false;
            }
            self.saveDraftsToStorage();
        });

        this.smeaDynCheck.addEventListener('change', (e) => {
            const activeDraft = self.getActiveDraft();
            activeDraft.params.smeaDyn = e.target.checked;
            self.saveDraftsToStorage();
        });

        // 参考图拖拽上传
        this.vibeDropzone.addEventListener('click', () => {
            self.vibeFileInput.click();
        });

        this.vibeDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            self.vibeDropzone.style.borderColor = 'var(--text-primary)';
        });

        this.vibeDropzone.addEventListener('dragleave', () => {
            self.vibeDropzone.style.borderColor = 'var(--glass-border)';
        });

        this.vibeDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            self.vibeDropzone.style.borderColor = 'var(--glass-border)';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                self.handleVibeImageUpload(e.dataTransfer.files[0]);
            }
        });

        this.vibeFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                self.handleVibeImageUpload(e.target.files[0]);
            }
        });

        this.btnClearVibe.addEventListener('click', (e) => {
            e.stopPropagation();
            self.clearVibeImage();
        });

        setupSliderNumberPair(this.vibeStrengthSlider, this.vibeStrengthNum, 'vibeStrength');

        // 生成按钮绑定
        this.btnGenerate.addEventListener('click', () => {
            self.triggerGeneration();
        });

        this.btnRollX4.addEventListener('click', () => {
            self.triggerRollX4();
        });

        // 画廊过滤过滤标签
        this.engineFilterTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                self.engineFilterTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                self.refreshGallery();
            });
        });

        // 批量管理开关
        this.btnToggleBatch.addEventListener('click', () => {
            self.enableBatchMode(true);
        });

        this.btnBatchCancel.addEventListener('click', () => {
            self.enableBatchMode(false);
        });

        this.btnBatchSelectAll.addEventListener('click', () => {
            const cards = self.galleryGrid.querySelectorAll('.gallery-item-card');
            const allSelected = self.selectedImageIds.size === cards.length;
            self.selectedImageIds.clear();
            
            if (!allSelected) {
                cards.forEach(card => {
                    const id = card.dataset.id;
                    self.selectedImageIds.add(id);
                    card.querySelector('.gallery-card-checkbox').checked = true;
                });
            } else {
                cards.forEach(card => {
                    card.querySelector('.gallery-card-checkbox').checked = false;
                });
            }
            self.updateBatchActionBarUI();
        });

        // 批量下载
        this.btnBatchDownload.addEventListener('click', () => {
            if (self.selectedImageIds.size === 0) return;
            self.downloadMultipleImages(Array.from(self.selectedImageIds));
        });

        // 批量删除 (需二次安全确认)
        this.btnBatchDelete.addEventListener('click', () => {
            if (self.selectedImageIds.size === 0) return;
            const count = self.selectedImageIds.size;
            if (confirm(`高危安全确认：您确定要永久删除这 ${count} 张生成的画作吗？\n该操作无法撤销。`)) {
                GalleryDB.deleteMultiple(Array.from(self.selectedImageIds)).then(() => {
                    self.selectedImageIds.clear();
                    self.enableBatchMode(false);
                    self.refreshGallery();
                    self.showNotification(`成功移除 ${count} 张历史图片`);
                });
            }
        });

        // 队列悬浮侧边栏
        this.queueCapsule.addEventListener('click', () => {
            self.queueDrawer.classList.toggle('active');
        });

        this.btnCloseQueueDrawer.addEventListener('click', () => {
            self.queueDrawer.classList.remove('active');
        });

        // Lightbox 大图关闭事件
        this.lightboxClose.addEventListener('click', () => {
            self.lightbox.classList.remove('active');
        });

        this.btnCopyMetaPrompt.addEventListener('click', () => {
            const text = self.lightboxPrompt.textContent;
            navigator.clipboard.writeText(text).then(() => {
                self.showNotification('正面提示词已复制到剪贴板');
            });
        });

        this.btnLightboxDownload.addEventListener('click', () => {
            const currentImgId = self.lightbox.dataset.imgId;
            self.downloadSingleImage(currentImgId);
        });

        this.btnLightboxDelete.addEventListener('click', () => {
            const currentImgId = self.lightbox.dataset.imgId;
            if (confirm('高危安全确认：您确定要永久删除此图片记录吗？\n该操作无法撤销。')) {
                GalleryDB.delete(currentImgId).then(() => {
                    self.lightbox.classList.remove('active');
                    self.refreshGallery();
                    self.showNotification('图片已删除');
                });
            }
        });

        // Lightbox 复用参数
        this.btnLightboxReuse.addEventListener('click', () => {
            const currentImgId = self.lightbox.dataset.imgId;
            self.reuseImageParams(currentImgId);
        });

        // Lightbox 变体生成 Roll X4
        this.btnLightboxRoll.addEventListener('click', () => {
            const currentImgId = self.lightbox.dataset.imgId;
            self.rollVariationsFromId(currentImgId);
        });
    },

    // ==========================================================================
    // 4. 草稿切换与 UI 数据同步
    // ==========================================================================
    getActiveDraft() {
        return this.drafts.find(d => d.id === this.activeDraftId) || this.drafts[0];
    },

    renderDraftTabs() {
        const self = this;
        this.draftTabsList.innerHTML = '';
        this.drafts.forEach(draft => {
            const btn = document.createElement('button');
            btn.className = `draft-tab-chip ${draft.id === self.activeDraftId ? 'active' : ''}`;
            btn.textContent = draft.name;
            btn.addEventListener('click', () => {
                self.activeDraftId = draft.id;
                self.syncUIWithActiveDraft();
                self.renderDraftTabs();
            });
            this.draftTabsList.appendChild(btn);
        });
    },

    syncUIWithActiveDraft() {
        const draft = this.getActiveDraft();
        
        // 后端
        this.backendSelect.value = draft.targetBackend;
        
        // 提示词
        this.promptInput.value = draft.prompt || '';
        this.negativeInput.value = draft.negativePrompt || '';

        // 渲染参数
        const p = draft.params;
        this.stepsSlider.value = p.steps;
        this.stepsNum.value = p.steps;
        this.scaleSlider.value = p.scale;
        this.scaleNum.value = p.scale;
        this.samplerSelect.value = p.sampler || 'k_euler';
        this.seedInput.value = p.seed;

        // 根据后端切换显示
        if (draft.targetBackend === 'novelai') {
            this.naiParamsWrap.style.display = 'block';
            this.smeaCheck.checked = !!p.smea;
            this.smeaDynWrap.style.display = p.smea ? 'block' : 'none';
            this.smeaDynCheck.checked = !!p.smeaDyn;
            this.btnRollX4.style.display = 'block';
        } else {
            this.naiParamsWrap.style.display = 'none';
            this.btnRollX4.style.display = 'none';
        }

        // 尺寸比例
        let matched = false;
        this.ratioButtons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.ratio === `${p.width}x${p.height}`) {
                btn.classList.add('active');
                matched = true;
            }
        });
        if (!matched) {
            const customBtn = Array.from(this.ratioButtons).find(b => b.dataset.custom);
            if (customBtn) {
                customBtn.classList.add('active');
                this.customDimensionWrap.style.display = 'grid';
                this.customW.value = p.width;
                this.customH.value = p.height;
            }
        } else {
            this.customDimensionWrap.style.display = 'none';
        }

        // 参考图渲染
        if (p.vibeBase64) {
            this.vibePlaceholder.style.display = 'none';
            this.vibePreview.style.display = 'flex';
            this.vibePreviewImg.src = p.vibeBase64;
            this.vibeIntensityWrap.style.display = 'block';
            this.vibeStrengthSlider.value = p.vibeStrength;
            this.vibeStrengthNum.value = p.vibeStrength;
        } else {
            this.vibePlaceholder.style.display = 'flex';
            this.vibePreview.style.display = 'none';
            this.vibePreviewImg.src = '';
            this.vibeIntensityWrap.style.display = 'none';
        }

        // 渲染画师
        this.renderArtistChips();
    },

    // ==========================================================================
    // 5. 画师实验室 (Artist Lab) 算法与逻辑实现
    // ==========================================================================
    renderArtistChips() {
        const self = this;
        const draft = this.getActiveDraft();
        this.artistChipsWrap.innerHTML = '';

        if (!draft.artists || draft.artists.length === 0) {
            const emptyTip = document.createElement('p');
            emptyTip.className = 'empty-chips-text';
            emptyTip.textContent = '从提示词书引入画师词条，即可在此处微调权重或启用混搭调色盘。';
            this.artistChipsWrap.appendChild(emptyTip);
            return;
        }

        draft.artists.forEach((art, index) => {
            const chip = document.createElement('div');
            chip.className = 'artist-chip';
            chip.innerHTML = `
                <span class="artist-chip-name">${art.name}</span>
                <span class="artist-chip-weight">${art.weight.toFixed(2)}</span>
                <button class="btn-chip-adjust" data-action="inc" title="增加权重">+</button>
                <button class="btn-chip-adjust" data-action="dec" title="降低权重">-</button>
                <button class="btn-chip-remove" title="移除">
                    <svg viewBox="0 0 24 24" width="10" height="10" stroke="currentColor" stroke-width="2" fill="none"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            `;

            // 微调权重
            chip.querySelectorAll('.btn-chip-adjust').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.dataset.action;
                    if (action === 'inc') {
                        art.weight = Math.min(2.5, art.weight + 0.05);
                    } else {
                        art.weight = Math.max(0.1, art.weight - 0.05);
                    }
                    self.saveDraftsToStorage();
                    self.renderArtistChips();
                });
            });

            // 移除芯片
            chip.querySelector('.btn-chip-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                draft.artists.splice(index, 1);
                self.saveDraftsToStorage();
                self.renderArtistChips();
            });

            this.artistChipsWrap.appendChild(chip);
        });
    },

    // 风格张力控制核心逻辑（凝聚力 vs 冲突感）
    applyTensionLogic(tensionValue) {
        const draft = this.getActiveDraft();
        if (!draft.artists || draft.artists.length === 0) {
            this.tensionDisplay.textContent = '暂无画师 (无法调控)';
            return;
        }

        // 映射文案
        if (tensionValue <= 30) {
            this.tensionDisplay.textContent = `凝聚 (稳定: ${tensionValue}%)`;
        } else if (tensionValue <= 70) {
            this.tensionDisplay.textContent = `均衡 (跨界: ${tensionValue}%)`;
        } else {
            this.tensionDisplay.textContent = `冲突 (先锋: ${tensionValue}%)`;
        }

        // 算法：控制画师权重的分布离散度 (Variance)
        // 凝聚时（极低张力）：所有画师权重向 1.0 或 1.1 的中心靠拢，确保风格稳定。
        // 冲突时（极高张力）：放大权重的极化。比如赋予主导者更高的权重(如1.5)，而让其他风格严重减弱(如0.4)，甚至制造剧烈的权重起伏。
        const avg = 1.1;
        const total = draft.artists.length;

        draft.artists.forEach((art, idx) => {
            // 根据张力值计算偏离因子
            const deviationFactor = (tensionValue - 20) / 100; // -0.2 ➔ 0.8
            // 创造基于 idx 的正负起伏
            const wave = idx % 2 === 0 ? 1 : -1;
            // 波动大小直接取决于张力
            const delta = wave * deviationFactor * 0.45;
            art.weight = Math.max(0.2, Math.min(2.0, avg + delta));
        });

        this.saveDraftsToStorage();
        this.renderArtistChips();
    },

    // AI 一键权重配平算法
    autoWeightArtists() {
        const draft = this.getActiveDraft();
        if (!draft.artists || draft.artists.length === 0) {
            alert('请先添加画师。');
            return;
        }

        // 配平黄金配比规则：
        // 首位主要画师权重赋 1.25，辅助上色与特质画师递减至 1.05、0.85，以防多画师相互打架污染面部。
        draft.artists.forEach((art, idx) => {
            if (idx === 0) {
                art.weight = 1.25;
            } else if (idx === 1) {
                art.weight = 1.05;
            } else if (idx === 2) {
                art.weight = 0.85;
            } else {
                art.weight = 0.70;
            }
        });

        this.saveDraftsToStorage();
        this.renderArtistChips();
        this.showNotification('AI 已对画师队列一键应用黄金配平');
    },

    // 将画师胶囊串编译为引擎对应语法字符
    compileArtistsString() {
        const draft = this.getActiveDraft();
        if (!draft.artists || draft.artists.length === 0) return '';

        const backend = draft.targetBackend;
        const list = draft.artists.map(art => {
            const w = art.weight;
            const name = art.content || art.name;
            if (backend === 'novelai') {
                // NovelAI 使用 {} 增强语法（如 {name} 代表 1.05 倍，{{name}} 为 1.1 倍，[] 为减弱）
                // 转换近似公式：
                if (w > 1.4) return `{{{${name}}}}`;
                if (w > 1.2) return `{{${name}}}`;
                if (w > 1.05) return `{${name}}`;
                if (w < 0.7) return `[[${name}]]`;
                if (w < 0.9) return `[${name}]`;
                return name;
            } else {
                // SD / 兼容 API 均使用标准圆括号加系数，如 (name:1.2)
                if (Math.abs(w - 1.0) < 0.02) return name;
                return `(${name}:${w.toFixed(2)})`;
            }
        });

        return list.join(', ');
    },

    // 将正面提示词与画师串依据位置选择进行合并编译
    compileFullPrompt() {
        const draft = this.getActiveDraft();
        const basePrompt = draft.prompt || '';
        const artistsStr = this.compileArtistsString();
        
        if (!artistsStr) return basePrompt;

        const injectPos = document.querySelector('input[name="artist-inject-pos"]:checked')?.value || 'prefix';
        
        if (injectPos === 'prefix') {
            return basePrompt ? `${artistsStr}, ${basePrompt}` : artistsStr;
        } else {
            return basePrompt ? `${basePrompt}, ${artistsStr}` : artistsStr;
        }
    },

    // 观察全局缓冲区，如果处于 Studio 面板下点击，智能判断是追加提示词还是追加画师
    observeGlobalPromptBuffer() {
        const self = this;
        // 拦截全局点击事件以捕捉提示词胶囊的载入
        document.body.addEventListener('click', (e) => {
            // 判断是否是来自词库胶囊的点击
            const capsule = e.target.closest('.prompt-chip');
            if (!capsule) return;

            // 仅仅当生图面板处于活跃状态时拦截，避免冲突
            const studioPane = document.getElementById('pane-studio');
            if (!studioPane || !studioPane.classList.contains('active')) return;

            const name = capsule.querySelector('.prompt-name')?.textContent || capsule.textContent.trim();
            const content = capsule.dataset.content || name;
            const remark = capsule.dataset.remark || '';
            const categoryTitle = document.getElementById('current-category-title')?.textContent || '';

            // 如果点击的词条归属于画师分类，直接拦截引入到画师芯片区域
            if (categoryTitle.includes('画师') || remark.includes('artist') || name.includes('画师')) {
                // 阻止全局缓冲区拦截
                e.stopPropagation();
                e.preventDefault();
                self.addArtistToLab(name, content);
            } else {
                // 普通提示词无缝在活跃草稿中追加
                const draft = self.getActiveDraft();
                if (draft.prompt) {
                    if (!draft.prompt.endsWith(', ') && !draft.prompt.endsWith(',')) {
                        draft.prompt += ', ';
                    }
                    draft.prompt += content;
                } else {
                    draft.prompt = content;
                }
                self.promptInput.value = draft.prompt;
                self.saveDraftsToStorage();
            }
        });
    },

    // 画师加入实验室
    addArtistToLab(name, content) {
        const draft = this.getActiveDraft();
        draft.artists = draft.artists || [];
        
        // 避免重复引入
        if (draft.artists.some(a => a.content === content)) {
            this.showNotification('该画师已在控制台内');
            return;
        }

        draft.artists.push({
            id: 'art_' + Date.now(),
            name: name.replace(/\(画师\)/gi, '').trim(),
            content: content,
            weight: 1.1 // 默认推荐微增权重
        });

        this.saveDraftsToStorage();
        this.renderArtistChips();
        this.showNotification(`画师「${name}」已引入实验室`);
    },

    // ==========================================================================
    // 6. 快捷词库抽屉 (Lexicon Popover)
    // ==========================================================================
    renderPopoverCategories() {
        const self = this;
        const globalData = JSON.parse(localStorage.getItem('studio_workbench_data') || '{}');
        const prompts = globalData.prompts || {};
        const presets = prompts.presets || {};
        const custom = prompts.custom || {};

        this.popoverCats.innerHTML = '';
        
        // 合并所有的分类名
        const categories = [];
        Object.keys(presets).forEach(cat => categories.push({ type: 'preset', key: cat }));
        Object.keys(custom).forEach(cat => categories.push({ type: 'custom', key: cat }));

        if (categories.length === 0) {
            this.popoverCats.innerHTML = '<span class="empty-chips-text">词库内无可用分类</span>';
            return;
        }

        categories.forEach((cat, index) => {
            const chip = document.createElement('span');
            chip.className = `popover-cat-chip ${index === 0 ? 'active' : ''}`;
            // 中文友好别名转换
            chip.textContent = self.getFriendlyCategoryName(cat.key);
            chip.addEventListener('click', () => {
                self.popoverCats.querySelectorAll('.popover-cat-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                self.renderPopoverItems(cat.type, cat.key, prompts);
            });
            this.popoverCats.appendChild(chip);
        });

        // 默认显示第一个分类
        const first = categories[0];
        if (first) {
            self.renderPopoverItems(first.type, first.key, prompts);
        }
    },

    renderPopoverItems(type, catKey, prompts) {
        const self = this;
        this.popoverItemsGrid.innerHTML = '';
        const list = type === 'preset' ? prompts.presets[catKey] : prompts.custom[catKey];

        if (!list || list.length === 0) {
            this.popoverItemsGrid.innerHTML = '<p class="empty-chips-text">无词条记录</p>';
            return;
        }

        list.forEach(item => {
            const btn = document.createElement('button');
            btn.className = 'popover-item-btn';
            btn.textContent = item.name;
            btn.title = item.content;
            btn.addEventListener('click', () => {
                // 根据是否是画师进行分流
                if (catKey.includes('artist') || catKey.includes('画师') || (item.remark && item.remark.includes('artist'))) {
                    self.addArtistToLab(item.name, item.content);
                } else {
                    // 普通追加
                    const draft = self.getActiveDraft();
                    if (draft.prompt) {
                        draft.prompt = draft.prompt.trim();
                        if (draft.prompt && !draft.prompt.endsWith(',')) {
                            draft.prompt += ', ';
                        } else if (draft.prompt.endsWith(',')) {
                            draft.prompt += ' ';
                        }
                        draft.prompt += item.content;
                    } else {
                        draft.prompt = item.content;
                    }
                    self.promptInput.value = draft.prompt;
                    self.saveDraftsToStorage();
                }
            });
            this.popoverItemsGrid.appendChild(btn);
        });
    },

    getFriendlyCategoryName(key) {
        const mapping = {
            style: '艺术风格',
            expression: '表情特征',
            character: '角色主体',
            outfit: '服装服饰',
            artistsCombo: '大师混搭',
            artistsSolo: '独立画师',
            scenery: '场景背景'
        };
        return mapping[key] || key;
    },

    // ==========================================================================
    // 7. 参考图与图生图 (Img2Img) 上传逻辑
    // ==========================================================================
    handleVibeImageUpload(file) {
        const self = this;
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target.result;
            const activeDraft = self.getActiveDraft();
            activeDraft.params.vibeBase64 = base64;
            self.saveDraftsToStorage();
            self.syncUIWithActiveDraft();
        };
        reader.readAsDataURL(file);
    },

    clearVibeImage() {
        const activeDraft = this.getActiveDraft();
        activeDraft.params.vibeBase64 = null;
        this.vibeFileInput.value = '';
        this.saveDraftsToStorage();
        this.syncUIWithActiveDraft();
    },

    // ==========================================================================
    // 8. 并发任务调度触发 (Generation Trigger)
    // ==========================================================================
    triggerGeneration() {
        const draft = this.getActiveDraft();
        const compiledPrompt = this.compileFullPrompt();

        if (!compiledPrompt.trim()) {
            alert('请先输入正面提示词或添加画师组合。');
            return;
        }

        // 构建任务对象
        const task = {
            backend: draft.targetBackend,
            prompt: compiledPrompt,
            params: JSON.parse(JSON.stringify(draft.params)) // 复制当前的独立参数快照
        };

        // 将任务推入全局并发调度器
        generatorQueue.enqueue(task);
        this.showNotification('已推入并发生图任务队列，请查看悬浮调度器');
    },

    // NovelAI 专属 Roll 4 变体变动生成
    triggerRollX4() {
        const draft = this.getActiveDraft();
        const compiledPrompt = this.compileFullPrompt();

        if (draft.targetBackend !== 'novelai') {
            alert('重Roll变体模式目前仅支持 NovelAI 后端。');
            return;
        }

        for (let i = 0; i < 4; i++) {
            const task = {
                backend: 'novelai',
                prompt: compiledPrompt,
                params: JSON.parse(JSON.stringify(draft.params))
            };
            // 每一个分配独立的随机 Seed
            task.params.seed = -1;
            generatorQueue.enqueue(task);
        }
        this.showNotification('已推入 4 张变体生成子任务进排队队列');
    },

    // ==========================================================================
    // 9. 任务列表 UI 渲染 (Queue Monitor Drawer)
    // ==========================================================================
    renderQueueUI({ queue, active }) {
        const self = this;
        const total = queue.length + active.length;

        if (total > 0) {
            this.queueCapsule.style.display = 'flex';
            this.queueStatusText.textContent = `${active.length}/5 Generating (${queue.length} in queue)`;
            
            // 变更加载动效与文本
            this.generateSpinIcon.style.display = 'inline-block';
            this.btnGenerateText.textContent = 'GENERATING...';
        } else {
            this.queueCapsule.style.display = 'none';
            this.queueDrawer.classList.remove('active');
            
            this.generateSpinIcon.style.display = 'none';
            this.btnGenerateText.textContent = 'GENERATE';
        }

        this.queueDrawerList.innerHTML = '';
        if (total === 0) {
            this.queueDrawerList.innerHTML = '<p class="queue-empty-text">当前无等待或运行中的生图任务</p>';
            return;
        }

        // 首先渲染正在执行的
        active.forEach(task => {
            const item = document.createElement('div');
            item.className = 'queue-task-item';
            item.innerHTML = `
                <div class="queue-task-meta">
                    <span class="task-badge-container">
                        <span class="task-backend-badge">${task.backend}</span>
                    </span>
                    <span class="task-status-text generating">生成中</span>
                </div>
                <div class="task-prompt-excerpt" title="${task.prompt}">${task.prompt}</div>
                <div class="task-progress-track">
                    <div class="task-progress-bar generating-shimmer"></div>
                </div>
                <button class="btn-cancel-task" data-id="${task.id}">取消任务</button>
            `;
            item.querySelector('.btn-cancel-task').addEventListener('click', () => {
                generatorQueue.cancel(task.id);
            });
            this.queueDrawerList.appendChild(item);
        });

        // 渲染排队中的
        queue.forEach((task, idx) => {
            const item = document.createElement('div');
            item.className = 'queue-task-item';
            item.innerHTML = `
                <div class="queue-task-meta">
                    <span class="task-backend-badge">${task.backend}</span>
                    <span class="task-status-text waiting">排队 [${idx + 1}]</span>
                </div>
                <div class="task-prompt-excerpt" title="${task.prompt}">${task.prompt}</div>
                <div class="task-progress-track">
                    <div class="task-progress-bar" style="width: 0%;"></div>
                </div>
                <button class="btn-cancel-task" data-id="${task.id}">移除</button>
            `;
            item.querySelector('.btn-cancel-task').addEventListener('click', () => {
                generatorQueue.cancel(task.id);
            });
            this.queueDrawerList.appendChild(item);
        });
    },

    // ==========================================================================
    // 10. 画廊展示与大图弹窗查看 (Gallery & Lightbox)
    // ==========================================================================
    async refreshGallery() {
        const self = this;
        const allItems = await GalleryDB.getAll();
        
        // 获知当前过滤类型
        const activeFilterTab = document.querySelector('.engine-filter-tabs button.active');
        const filter = activeFilterTab ? activeFilterTab.dataset.filter : 'all';

        const filtered = allItems.filter(item => {
            if (filter === 'all') return true;
            return item.backend === filter;
        });

        this.galleryCountLabel.textContent = `共 ${filtered.length} 张作品`;
        this.galleryGrid.innerHTML = '';

        if (filtered.length === 0) {
            this.galleryGrid.innerHTML = '<div class="empty-chips-text" style="grid-column: 1/-1; padding: 4rem 0;">画廊目前空空如也...</div>';
            return;
        }

        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = 'gallery-item-card';
            card.dataset.id = item.id;

            // 创建 Blob URL 供渲染
            const blobUrl = URL.createObjectURL(item.imageBlob);

            card.innerHTML = `
                <input type="checkbox" class="gallery-card-checkbox" data-id="${item.id}" ${self.selectedImageIds.has(item.id) ? 'checked' : ''}>
                <img src="${blobUrl}" alt="历史出图" loading="lazy">
                <div class="gallery-hover-overlay">
                    <div class="gallery-meta-snippet">${item.params.width}x${item.params.height} | S:${item.params.seed}</div>
                    <div class="gallery-card-actions">
                        <button class="gallery-card-btn btn-view-action">放大</button>
                        <button class="gallery-card-btn btn-reuse-action">复用</button>
                    </div>
                </div>
            `;

            // 点击卡片分流
            card.addEventListener('click', (e) => {
                if (self.batchMode) {
                    // 批量多选状态下，点击切换勾选状态
                    const check = card.querySelector('.gallery-card-checkbox');
                    check.checked = !check.checked;
                    if (check.checked) {
                        self.selectedImageIds.add(item.id);
                    } else {
                        self.selectedImageIds.delete(item.id);
                    }
                    self.updateBatchActionBarUI();
                } else {
                    // 正常状态下，点击放大或操作
                    const isReuse = e.target.classList.contains('btn-reuse-action');
                    if (isReuse) {
                        e.stopPropagation();
                        self.reuseImageParams(item.id);
                    } else {
                        self.openLightbox(item, blobUrl);
                    }
                }
            });

            // 监听 Checkbox 自身更改
            card.querySelector('.gallery-card-checkbox').addEventListener('click', (e) => {
                e.stopPropagation();
                const check = e.target;
                if (check.checked) {
                    self.selectedImageIds.add(item.id);
                } else {
                    self.selectedImageIds.delete(item.id);
                }
                self.updateBatchActionBarUI();
            });

            this.galleryGrid.appendChild(card);
        });
    },

    openLightbox(item, blobUrl) {
        this.lightbox.dataset.imgId = item.id;
        this.lightboxImg.src = blobUrl;
        
        const dateStr = new Date(item.timestamp).toLocaleString();
        this.lightboxTimestamp.textContent = `生成时间: ${dateStr}`;
        this.lightboxEngine.textContent = `${item.backend.toUpperCase()} (${item.params.model || 'DEFAULT MODEL'})`;
        this.lightboxPrompt.textContent = item.prompt;
        
        if (item.negativePrompt) {
            this.lightboxNegativeSection.style.display = 'flex';
            this.lightboxNegative.textContent = item.negativePrompt;
        } else {
            this.lightboxNegativeSection.style.display = 'none';
        }

        this.lightboxSeed.textContent = item.params.seed;
        this.lightboxDimension.textContent = `${item.params.width} x ${item.params.height}`;
        this.lightboxSteps.textContent = item.params.steps;
        this.lightboxScale.textContent = item.params.scale;
        this.lightboxSampler.textContent = item.params.sampler;

        // 仅 NovelAI 模式支持变体 Roll
        if (item.backend === 'novelai') {
            this.btnLightboxRoll.style.display = 'block';
        } else {
            this.btnLightboxRoll.style.display = 'none';
        }

        this.lightbox.classList.add('active');
    },

    // 一键复用历史出图参数
    async reuseImageParams(imgId) {
        const all = await GalleryDB.getAll();
        const found = all.find(i => i.id === imgId);
        if (!found) return;

        // 回填到当前草稿
        const draft = this.getActiveDraft();
        draft.targetBackend = found.backend;
        draft.prompt = found.prompt;
        draft.negativePrompt = found.negativePrompt || '';
        
        draft.params.width = found.params.width;
        draft.params.height = found.params.height;
        draft.params.steps = found.params.steps;
        draft.params.scale = found.params.scale;
        draft.params.sampler = found.params.sampler;
        draft.params.seed = found.params.seed;
        draft.params.model = found.params.model || 'nai-diffusion-3';
        draft.params.smea = found.params.smea || false;
        draft.params.smeaDyn = found.params.smeaDyn || false;

        this.saveDraftsToStorage();
        this.syncUIWithActiveDraft();
        
        this.lightbox.classList.remove('active');
        this.showNotification('出图参数已成功填回控制台');
    },

    // 变体再生成 Roll x4
    async rollVariationsFromId(imgId) {
        const all = await GalleryDB.getAll();
        const found = all.find(i => i.id === imgId);
        if (!found) return;

        for (let i = 0; i < 4; i++) {
            const task = {
                backend: found.backend,
                prompt: found.prompt,
                params: JSON.parse(JSON.stringify(found.params))
            };
            task.params.seed = -1; // 随机 Seed 产生变体
            generatorQueue.enqueue(task);
        }
        
        this.lightbox.classList.remove('active');
        this.showNotification('已发送 4 张变体生成请求至调度器');
    },

    // ==========================================================================
    // 11. 批量管理模块
    // ==========================================================================
    enableBatchMode(enable) {
        this.batchMode = enable;
        this.selectedImageIds.clear();
        this.updateBatchActionBarUI();

        // 显隐 Checkbox 勾选框
        const checkboxes = this.galleryGrid.querySelectorAll('.gallery-card-checkbox');
        checkboxes.forEach(chk => {
            chk.style.display = enable ? 'block' : 'none';
            chk.checked = false;
        });

        this.btnToggleBatch.style.display = enable ? 'none' : 'block';
        this.batchActionsBar.style.display = enable ? 'flex' : 'none';
    },

    updateBatchActionBarUI() {
        this.batchSelectedCount.textContent = this.selectedImageIds.size;
    },

    async downloadSingleImage(id) {
        const all = await GalleryDB.getAll();
        const found = all.find(i => i.id === id);
        if (!found) return;

        const url = URL.createObjectURL(found.imageBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${found.backend}_${found.params.seed}_${found.id}.png`;
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
