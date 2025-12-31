document.addEventListener('DOMContentLoaded', () => {
    const resizeBtn = document.getElementById('resizeBtn');
    const captureBtn = document.getElementById('captureBtn');
    const noteInput = document.getElementById('noteInput');
    const recordBtn = document.getElementById('recordBtn');
    const recordingStatus = document.getElementById('recordingStatus');
    const slidesList = document.getElementById('slidesList');
    const exportBtn = document.getElementById('exportBtn');
    const statusMessage = document.getElementById('statusMessage');
    const slideCount = document.getElementById('slideCount');

    // Settings UI
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    const gasUrlInput = document.getElementById('gasUrlInput');
    const modelSelect = document.getElementById('modelSelect');
    const refreshModelsBtn = document.getElementById('refreshModelsBtn');
    const polishCheckbox = document.getElementById('polishCheckbox');
    const promptInput = document.getElementById('promptInput');
    const resetPromptBtn = document.getElementById('resetPromptBtn');

    // Default Prompt (Japanese Polishing)
    const DEFAULT_PROMPT = "あなたはプロの編集者です。以下のテキストはスピーカーノートのメモです。これを「必ず」書き直してください。元の意味を維持しつつ、より説得力のある、自然な日本語の話し言葉（スピーチ原稿）に変換してください。短すぎる場合も、前後の文脈を想像して自然な文章に膨らませてください。\n\n[元のテキスト]: ";

    let slides = []; // { image, note }
    let recognition;

    // --- Settings Logic ---
    // Load saved settings
    chrome.storage.local.get(['gasUrl', 'geminiModel', 'availableModels', 'customPrompt'], (result) => {
        if (result.gasUrl) gasUrlInput.value = result.gasUrl;

        // Restore available models if cached
        if (result.availableModels && Array.isArray(result.availableModels)) {
            populateModelSelect(result.availableModels, result.geminiModel);
        } else if (result.geminiModel) {
            // If only model name saved but no list, ensure it's selected (custom add)
            addOption(modelSelect, result.geminiModel, result.geminiModel, true);
        }

        // Restore prompt or set default
        promptInput.value = result.customPrompt || DEFAULT_PROMPT;
    });

    function addOption(select, text, value, isSelected) {
        // Check if exists
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value === value) {
                if (isSelected) select.selectedIndex = i;
                return;
            }
        }
        const option = document.createElement('option');
        option.text = text;
        option.value = value;
        if (isSelected) option.selected = true;
        select.add(option);
    }

    function populateModelSelect(models, selectedValue) {
        // Keep default if empty
        if (!models || models.length === 0) return;

        // Clear existing (except maybe default if we want to keep it? No, replace.)
        modelSelect.innerHTML = "";

        models.forEach(model => {
            const name = model.name.replace('models/', ''); // Display friendly name
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            if (name === selectedValue) option.selected = true;
            modelSelect.appendChild(option);
        });

        // Ensure default is there if nothing matched
        if (modelSelect.selectedIndex === -1 && modelSelect.options.length > 0) {
            modelSelect.selectedIndex = 0;
        }
    }

    settingsBtn.addEventListener('click', () => {
        settingsModal.showModal();
    });

    saveSettingsBtn.addEventListener('click', () => {
        chrome.storage.local.set({
            gasUrl: gasUrlInput.value.trim(),
            geminiModel: modelSelect.value,
            customPrompt: promptInput.value // Save raw input (even if empty/changed)
        }, () => {
            settingsModal.close();
        });
    });

    // --- Model Refresh Logic ---
    refreshModelsBtn.addEventListener('click', async () => {
        const gasUrl = gasUrlInput.value.trim();
        if (!gasUrl) {
            alert("GASのURLを設定してください。");
            return;
        }

        refreshModelsBtn.disabled = true;
        refreshModelsBtn.textContent = "⌛";

        try {
            const response = await fetch(gasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify({ action: 'listModels' })
            });

            if (!response.ok) throw new Error("HTTP " + response.status);

            const data = await response.json();

            if (data.success && data.models) {
                populateModelSelect(data.models, modelSelect.value);
                // Save to storage
                chrome.storage.local.set({ availableModels: data.models });
                alert("モデル一覧を更新しました！");
            } else {
                alert("モデルの取得に失敗しました: " + (data.error || "不明なエラー"));
            }

        } catch (e) {
            alert("エラー: " + e.message);
        } finally {
            refreshModelsBtn.disabled = false;
            refreshModelsBtn.textContent = "🔄";
        }
    });

    // --- Reset Prompt Logic ---
    resetPromptBtn.addEventListener('click', () => {
        if (confirm("カスタムプロンプトを初期値に戻しますか？")) {
            promptInput.value = DEFAULT_PROMPT;
        }
    });

    // --- 1. Resize Window ---
    resizeBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ action: "resizeWindow169" });
    });

    // --- 2. Speech-to-Text Logic ---
    if ('webkitSpeechRecognition' in window) {
        recognition = new webkitSpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'ja-JP';

        recognition.onstart = () => {
            recordingStatus.classList.remove('hidden');
            recordBtn.textContent = "⏹ 停止";
            recordBtn.classList.add('recording-active');
        };

        recognition.onend = () => {
            recordingStatus.classList.add('hidden');
            recordBtn.textContent = "🎤 音声入力を開始";
            recordBtn.classList.remove('recording-active');
        };

        recognition.onresult = (event) => {
            let finalTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; ++i) {
                if (event.results[i].isFinal) {
                    finalTranscript += event.results[i][0].transcript;
                }
            }
            if (finalTranscript) {
                const currentText = noteInput.value;
                noteInput.value = currentText + (currentText ? "\n" : "") + finalTranscript;
            }
        };

        recordBtn.addEventListener('click', () => {
            if (recordingStatus.classList.contains('hidden')) {
                try { recognition.start(); } catch (e) { console.error(e); }
            } else {
                recognition.stop();
            }
        });

    } else {
        recordBtn.disabled = true;
        recordBtn.textContent = "Chromeの音声APIがサポートされていません";
    }

    // --- 3. Capture Slide ---
    captureBtn.addEventListener('click', async () => {
        try {
            captureBtn.textContent = "📸 撮影中...";
            await new Promise(r => setTimeout(r, 50));

            chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
                captureBtn.textContent = "📸 スライドを撮影";

                if (chrome.runtime.lastError) {
                    alert("撮影エラー: " + chrome.runtime.lastError.message);
                    return;
                }
                if (!dataUrl) {
                    alert("撮影失敗: 画像データがありません。");
                    return;
                }

                const note = noteInput.value;
                const slideData = {
                    id: Date.now(),
                    image: dataUrl,
                    note: note
                };

                slides.push(slideData);
                updateSlideCount();
                renderSlideItem(slideData);

                noteInput.value = "";
            });
        } catch (e) {
            console.error(e);
            alert("エラー: " + e.message);
            captureBtn.textContent = "📸 スライドを撮影";
        }
    });

    function updateSlideCount() {
        slideCount.textContent = slides.length;
    }

    function renderSlideItem(slideData) {
        const div = document.createElement('div');
        div.className = 'slide-item';
        div.id = 'slide-' + slideData.id;
        div.innerHTML = `
            <img src="${slideData.image}" alt="Slide">
            <div class="note-container">
                <label>スピーカーノート:</label>
                <textarea class="speaker-note-input" rows="3" placeholder="スピーカーノートを入力...">${slideData.note || ''}</textarea>
            </div>
            <button class="remove-slide">×</button>
        `;

        div.querySelector('.speaker-note-input').addEventListener('input', (e) => {
            const updatedNote = e.target.value;
            const s = slides.find(item => item.id === slideData.id);
            if (s) s.note = updatedNote;
        });

        div.querySelector('.remove-slide').addEventListener('click', () => {
            slides = slides.filter(s => s.id !== slideData.id);
            div.remove();
            updateSlideCount();
        });

        slidesList.appendChild(div);
        slidesList.scrollTop = slidesList.scrollHeight;
    }

    // --- 4. Export to GAS ---
    exportBtn.addEventListener('click', async () => {
        const gasUrl = gasUrlInput.value.trim();
        if (!gasUrl) {
            alert("⚠️ 設定からGAS WebアプリのURLを設定してください。");
            settingsModal.showModal();
            return;
        }
        if (slides.length === 0) {
            alert("⚠️ 書き出すスライドがありません。");
            return;
        }

        const useGemini = polishCheckbox.checked;
        const overlayNotes = document.getElementById('overlayNotesCheckbox').checked;

        // Get model from select or storage
        let selectedModel = modelSelect.value || "gemini-1.5-flash-latest";

        // Use prompt from Input, or fallback to default if somehow empty (though we fill it on load)
        const customPrompt = promptInput.value || DEFAULT_PROMPT;

        statusMessage.textContent = "🚀 書き出し中 (GASへ送信)...";
        exportBtn.disabled = true;

        try {
            const payload = {
                action: 'export',
                slides: slides.map(s => ({
                    image: s.image,
                    note: s.note
                })),
                useGemini: useGemini,
                overlayNotes: overlayNotes,
                geminiModel: selectedModel,
                customPrompt: customPrompt
            };

            const response = await fetch(gasUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error("HTTP " + response.status);

            const data = await response.json();

            if (data.success) {
                statusMessage.innerHTML = `✅ 完了! <a href="${data.url}" target="_blank">スライドを開く</a>`;
            } else {
                statusMessage.textContent = "❌ エラー: " + (data.error || "不明");
                alert("GAS エラー: " + data.error);
            }

        } catch (err) {
            console.error(err);
            statusMessage.textContent = "❌ 通信エラー";
            alert("書き出し失敗: " + err.message);
        } finally {
            exportBtn.disabled = false;
        }
    });
});
